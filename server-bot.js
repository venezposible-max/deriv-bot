const WebSocket = require('ws');
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// ==========================================
// CONFIGURACIÓN DEL BOT - MULTI-ESTRATEGIA
// ==========================================
const APP_ID = 1089;
let SYMBOL = 'R_100'; // Símbolo por defecto
const STATE_FILE = path.join(__dirname, 'persistent-state.json');

// --- PARÁMETROS DINÁMICOS (ESTRATEGIA 1) ---
let DYNAMIC_CONFIG = {
    stake: 10,
    takeProfit: 0.30,
    multiplier: 40,
    momentum: 5,
    stopLoss: 3.00
};

// --- PARÁMETROS SNIPER V3 (TREND FOLLOWER) ---
const SNIPER_CONFIG = {
    stake: 20,
    takeProfit: 4.00,
    stopLoss: 12.00, // Protección Blindada
    multiplier: 40,
    smaPeriod: 50,
    rsiPeriod: 14,
    rsiLow: 30, // Filtro de zona para UP
    rsiHigh: 70, // Filtro de zona para DOWN
    momentum: 5   // 5 Ticks de confirmación
};

// Auth y Variables
const API_TOKEN = process.env.DERIV_TOKEN;
const WEB_PASSWORD = process.env.WEB_PASSWORD || "colina123";

if (!API_TOKEN) {
    console.error('❌ ERROR: No se encontró el token de Deriv. Define DERIV_TOKEN en Railway.');
}

// === ESTADO GLOBAL DEL BOT ===
let botState = {
    isRunning: false,
    activeStrategy: 'SNIPER', // 'SNIPER' por defecto como pidió el usuario
    isConnectedToDeriv: false,
    balance: 0,
    totalTradesSession: 0,
    winsSession: 0,
    lossesSession: 0,
    pnlSession: 0,
    activeSymbol: 'R_100', // Símbolo activo (R_100 o frxXAUUSD)
    currentContractId: null,
    currentMaxProfit: 0,
    lastSlAssigned: -12,
    activeContracts: [],
    activeProfit: 0,
    currentContractType: null, // Tipo de contrato activo (MULTUP/MULTDOWN)
    lastTradeTime: null,
    cooldownRemaining: 0, // Segundos de enfriamiento restantes
    customToken: null, // Token ingresado manualmente por el usuario
    connectionError: null, // Error de conexión actual
    tradeHistory: []
};

// --- CARGAR ESTADO ---
if (fs.existsSync(STATE_FILE)) {
    try {
        const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        botState = { ...botState, ...saved, isConnectedToDeriv: false, activeContracts: [], activeProfit: 0 };
        if (saved.DYNAMIC_CONFIG) DYNAMIC_CONFIG = { ...DYNAMIC_CONFIG, ...saved.DYNAMIC_CONFIG };
        if (saved.customToken) botState.customToken = saved.customToken;
        if (botState.activeSymbol) SYMBOL = botState.activeSymbol;
        console.log(`📦 ESTADO RECUPERADO: Estrategia=${botState.activeStrategy} | Mercado=${botState.activeSymbol} | Corriendo=${botState.isRunning}`);
    } catch (e) {
        console.error('⚠️ Error cargando el estado persistente:', e);
    }
}

// --- GUARDAR ESTADO ---
function saveState() {
    try {
        const dataToSave = {
            totalTradesSession: botState.totalTradesSession,
            winsSession: botState.winsSession,
            lossesSession: botState.lossesSession,
            pnlSession: botState.pnlSession,
            tradeHistory: botState.tradeHistory,
            activeStrategy: botState.activeStrategy,
            isRunning: botState.isRunning,
            DYNAMIC_CONFIG: DYNAMIC_CONFIG,
            customToken: botState.customToken
        };
        fs.writeFileSync(STATE_FILE, JSON.stringify(dataToSave, null, 2));
    } catch (e) {
        console.error('⚠️ Error guardando el estado:', e);
    }
}

// --- INDICADORES TÉCNICOS ---
function calculateSMA(prices, period) {
    if (prices.length < period) return null;
    const sum = prices.slice(-period).reduce((a, b) => a + b, 0);
    return sum / period;
}

function calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) return null;
    let gains = 0, losses = 0;
    const slice = prices.slice(-period - 1);
    for (let i = 1; i < slice.length; i++) {
        const diff = slice[i] - slice[i - 1];
        if (diff > 0) gains += diff; else losses += Math.abs(diff);
    }
    const avgLoss = losses / (period || 1);
    if (avgLoss === 0) return 100;
    const rs = (gains / period) / avgLoss;
    return 100 - (100 / (1 + rs));
}

let ws;
let isBuying = false;
let cooldownTime = 0;
let tickHistory = [];

console.log('🚀 Iniciando Servidor Multi-Estrategia 24/7...');

// ==========================================
// SERVIDOR WEB (CONTROL REMOTO)
// ==========================================
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/status', (req, res) => {
    res.json({
        success: true,
        data: botState,
        config: botState.activeStrategy === 'DYNAMIC' ? DYNAMIC_CONFIG : SNIPER_CONFIG,
        isSniper: botState.activeStrategy === 'SNIPER'
    });
});

app.post('/api/control', (req, res) => {
    const { action, password, stake, takeProfit, multiplier, strategy } = req.body;
    console.log(`📩 RECIBIDO EN SERVIDOR: Acción=${action} | Estrategia=${strategy} | Stake=${stake}`);

    if (password !== WEB_PASSWORD) {
        return res.status(401).json({ success: false, error: 'Contraseña incorrecta' });
    }

    if (strategy && (strategy === 'DYNAMIC' || strategy === 'SNIPER')) {
        if (botState.isRunning && botState.activeStrategy !== strategy) {
            console.log(`⚠️ INTENTO DE CAMBIO BLOQUEADO: No se puede cambiar a ${strategy} mientras ${botState.activeStrategy} está en ejecución.`);
            return res.status(400).json({ success: false, error: `El bot ya está corriendo en modo ${botState.activeStrategy}. Deténlo para cambiar.` });
        } else {
            botState.activeStrategy = strategy;
            saveState();
            console.log(`🔄 ESTRATEGIA SELECCIONADA: ${strategy}`);
        }
    }

    // --- CAMBIO DE SÍMBOLO (ORO / V100) ---
    const targetSymbol = req.body.symbol;
    if (targetSymbol && (targetSymbol === 'R_100' || targetSymbol === 'frxXAUUSD')) {
        if (botState.isRunning && botState.activeSymbol !== targetSymbol) {
            return res.status(400).json({ success: false, error: "Detén el bot para cambiar de mercado." });
        }
        botState.activeSymbol = targetSymbol;
        SYMBOL = targetSymbol;
        saveState();
        console.log(`🌍 MERCADO CAMBIADO A: ${SYMBOL === 'R_100' ? 'Volatility 100' : 'Oro (Gold)'}`);

        // Re-suscribirse a los ticks si ya estamos conectados
        if (ws && botState.isConnectedToDeriv) {
            ws.send(JSON.stringify({ forget_all: 'ticks' }));
            ws.send(JSON.stringify({ ticks: SYMBOL, subscribe: 1 }));
        }
    }

    if (action === 'START') {
        botState.isRunning = true;
        saveState();

        let actualStake = botState.activeStrategy === 'SNIPER' ? SNIPER_CONFIG.stake : (stake || DYNAMIC_CONFIG.stake);

        if (botState.activeStrategy === 'DYNAMIC') {
            if (stake) DYNAMIC_CONFIG.stake = Number(stake);
            if (takeProfit) DYNAMIC_CONFIG.takeProfit = Number(takeProfit);
            if (multiplier) DYNAMIC_CONFIG.multiplier = Number(multiplier);
            if (req.body.momentum) DYNAMIC_CONFIG.momentum = Number(req.body.momentum);
            if (req.body.stopLoss !== undefined) {
                const slVal = Number(req.body.stopLoss);
                DYNAMIC_CONFIG.stopLoss = slVal > 0 ? slVal : null;
            }
        }

        console.log(`▶️ BOT ENCENDIDO: ${botState.activeStrategy} | Stake Real: $${actualStake}`);
        return res.json({ success: true, message: `Bot ${botState.activeStrategy} Activado`, isRunning: true });
    }

    if (action === 'STOP') {
        botState.isRunning = false;
        saveState(); // Guardar que el bot está apagado
        console.log(`⏸️ BOT DETENIDO: El usuario pausó el algoritmo.`);
        return res.json({ success: true, message: 'Bot Pausado', isRunning: false });
    }

    if (action === 'FORCE_CLEAR') {
        console.log('🧹 ADMIN: Limpieza manual de trades solicitada.');
        botState.currentContractId = null;
        botState.activeContracts = [];
        botState.activeProfit = 0;
        botState.currentMaxProfit = 0;
        botState.lastSlAssigned = -12;
        isBuying = false;
        saveState();
        return res.json({ success: true, message: 'Trades limpiados correctamente' });
    }

    res.status(400).json({ success: false, error: 'Acción inválida' });
});

app.post('/api/trade', (req, res) => {
    const { action, password } = req.body;
    if (password !== WEB_PASSWORD) return res.status(401).json({ success: false, error: 'Contraseña incorrecta' });
    if (botState.currentContractId || isBuying) return res.status(400).json({ success: false, error: 'Ya hay una operación en curso.' });
    if (action === 'MULTUP' || action === 'MULTDOWN') {
        executeTrade(action);
        return res.json({ success: true, message: `Disparo ${action} enviado` });
    }
    res.status(400).json({ success: false, error: 'Acción de trade inválida' });
});

app.post('/api/close', (req, res) => {
    const { password, contractId } = req.body;
    if (password !== WEB_PASSWORD) return res.status(401).json({ success: false, error: 'Contraseña incorrecta' });
    const idToClose = contractId || botState.currentContractId;
    if (!idToClose) return res.status(400).json({ success: false, error: 'No hay ninguna operación activa.' });
    ws.send(JSON.stringify({ sell: idToClose, price: 0 }));
    return res.json({ success: true, message: `Orden de cierre enviada para ${idToClose}` });
});

app.post('/api/clear-history', (req, res) => {
    const { password } = req.body;
    if (password !== WEB_PASSWORD) return res.status(401).json({ success: false, error: 'Contraseña incorrecta' });
    botState.tradeHistory = [];
    botState.totalTradesSession = 0;
    botState.winsSession = 0;
    botState.lossesSession = 0;
    botState.pnlSession = 0;
    saveState();
    return res.json({ success: true, message: 'Estadísticas reiniciadas' });
});

app.post('/api/admin/token', (req, res) => {
    const { password, token } = req.body;
    if (password !== WEB_PASSWORD) return res.status(401).json({ success: false, error: 'Contraseña incorrecta' });

    // Si el token viene vacío, volvemos al de Railway
    if (!token || token.trim() === "") {
        botState.customToken = null;
        saveState();
        console.log('🔑 ADMIN: Token manual eliminado. Volviendo a Token de Railway...');
    } else {
        if (token.length < 10) return res.status(400).json({ success: false, error: 'Token muy corto' });
        botState.customToken = token;
        saveState();
        console.log('🔑 ADMIN: Nuevo Token de Deriv configurado. Reconectando...');
    }

    if (ws) {
        ws.terminate();
    }

    res.json({ success: true, message: token ? 'Token guardado. Reconectando...' : 'Volviendo a Token Railway...' });
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🌍 Módulo Web en puerto ${PORT}`));

// ==========================================
// NÚCLEO DEL BOT (DERIV)
// ==========================================
function connectDeriv() {
    const activeToken = botState.customToken || process.env.DERIV_TOKEN;

    if (!activeToken) {
        console.error('❌ ERROR: No hay API Token configurado.');
        botState.isConnectedToDeriv = false;
        return;
    }

    ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

    ws.on('open', () => {
        console.log(`✅ Conectado a Deriv API ${botState.customToken ? '(Usando Token Manual)' : '(Usando Token Railway)'}`);
        ws.send(JSON.stringify({ authorize: activeToken }));
    });

    ws.on('message', (data) => {
        const msg = JSON.parse(data);
        if (msg.error) {
            console.error(`⚠️ Error: ${msg.error.message}`);
            botState.connectionError = msg.error.message;
            isBuying = false;

            // --- AUTO-CLEAN GHOST TRADES ON ERROR ---
            const errMsg = msg.error.message.toLowerCase();
            if (errMsg.includes('expired') ||
                errMsg.includes('not found') ||
                errMsg.includes('invalid contract') ||
                errMsg.includes('process your trade') ||
                errMsg.includes('cannot be sold')) {

                console.log('🧹 Limpiando trade fantasma detectado por error de Deriv...');
                botState.currentContractId = null;
                botState.activeContracts = [];
                botState.activeProfit = 0;
                botState.currentMaxProfit = 0;
                botState.lastSlAssigned = -12;
                saveState();
            }
            return;
        }

        if (msg.msg_type === 'authorize') {
            botState.isConnectedToDeriv = true;
            botState.connectionError = null;
            botState.balance = msg.authorize.balance;
            console.log(`✅ DERIV CONECTADO - Usuario: ${msg.authorize.fullname || 'Trader'} | Saldo inicial: $${botState.balance}`);
            ws.send(JSON.stringify({ ticks: SYMBOL, subscribe: 1 }));
            ws.send(JSON.stringify({ balance: 1, subscribe: 1 }));
            ws.send(JSON.stringify({ portfolio: 1 }));

            // --- SYNC PERIODICO (Evitar Fantasmas) ---
            if (global.syncTimer) clearInterval(global.syncTimer);
            global.syncTimer = setInterval(() => {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ portfolio: 1 }));
                }
            }, 15000); // Cada 15 segundos reconciliamos
        }

        if (msg.msg_type === 'portfolio') {
            const derivContracts = msg.portfolio.contracts || [];
            const derivIds = derivContracts.map(c => c.contract_id);

            // 1. RECONCILIACIÓN: Quitar trades que ya no existen en Deriv
            const beforeCount = botState.activeContracts.length;
            botState.activeContracts = botState.activeContracts.filter(ac => derivIds.includes(ac.id));

            if (beforeCount > botState.activeContracts.length) {
                console.log(`🧹 RECONCILIACIÓN: Se eliminaron ${beforeCount - botState.activeContracts.length} trades fantasma.`);
                if (botState.activeContracts.length === 0) {
                    botState.currentContractId = null;
                    botState.activeProfit = 0;
                } else if (!derivIds.includes(botState.currentContractId)) {
                    botState.currentContractId = botState.activeContracts[0].id;
                }
                saveState();
            }

            // 2. ADOPCIÓN: Añadir trades que existen en Deriv pero no en el bot
            derivContracts.forEach(c => {
                const isCorrectSymbol = c.symbol === SYMBOL || (SYMBOL === 'frxXAUUSD' && c.symbol.includes('XAUUSD'));
                if (isCorrectSymbol && !c.expiry_time && !botState.activeContracts.find(ac => ac.id === c.contract_id)) {
                    console.log(`📥 ADOPTando trade de Deriv: ${c.contract_id}`);
                    botState.activeContracts.push({ id: c.contract_id, profit: 0 });
                    botState.currentContractId = c.contract_id;
                    ws.send(JSON.stringify({ proposal_open_contract: 1, contract_id: c.contract_id, subscribe: 1 }));
                }
            });
        }

        if (msg.msg_type === 'balance') {
            botState.balance = msg.balance.balance;
            console.log(`💰 ACTUALIZACIÓN DE SALDO: $${botState.balance}`);
        }

        if (msg.msg_type === 'tick') {
            const quote = parseFloat(msg.tick.quote);
            tickHistory.push(quote);
            if (tickHistory.length > 100) tickHistory.shift();

            if (botState.isRunning && botState.isConnectedToDeriv && !botState.currentContractId && botState.cooldownRemaining === 0 && !isBuying) {

                const currentConfig = botState.activeStrategy === 'SNIPER' ? SNIPER_CONFIG : DYNAMIC_CONFIG;

                if (tickHistory.length >= currentConfig.momentum) {
                    const lastTicks = tickHistory.slice(-currentConfig.momentum);
                    const allDown = lastTicks.every((v, i) => i === 0 || v < lastTicks[i - 1]);
                    const allUp = lastTicks.every((v, i) => i === 0 || v > lastTicks[i - 1]);

                    let direction = null;

                    if (botState.activeStrategy === 'SNIPER') {
                        // --- LÓGICA TREND SNIPER V3 (Seguir Tendencia) ---
                        const trend = calculateSMA(tickHistory, SNIPER_CONFIG.smaPeriod);
                        const rsi = calculateRSI(tickHistory, SNIPER_CONFIG.rsiPeriod);

                        if (trend && rsi) {
                            // UP si tendencia alcista + fuerza confirmada + rsi no agotado
                            if (allUp && quote > trend && rsi < SNIPER_CONFIG.rsiHigh) direction = 'MULTUP';
                            // DOWN si tendencia bajista + fuerza confirmada + rsi no agotado
                            if (allDown && quote < trend && rsi > SNIPER_CONFIG.rsiLow) direction = 'MULTDOWN';
                        }
                    } else {
                        // --- LÓGICA DINÁMICA (ORIGINAL) ---
                        if (allDown) direction = 'MULTUP';
                        if (allUp) direction = 'MULTDOWN';
                    }

                    if (direction) executeTrade(direction);
                }
            }
        }

        if (msg.msg_type === 'buy') {
            isBuying = false;
            const newId = msg.buy.contract_id;
            botState.activeContracts.push({ id: newId, profit: 0 });
            botState.currentContractId = newId;
            botState.balance = msg.buy.balance_after;
            botState.lastTradeTime = new Date().toISOString();
            ws.send(JSON.stringify({ proposal_open_contract: 1, contract_id: newId, subscribe: 1 }));
        }

        if (msg.msg_type === 'proposal_open_contract') {
            const contract = msg.proposal_open_contract;
            if (contract && !contract.is_sold) {
                const idx = botState.activeContracts.findIndex(ac => ac.id === contract.contract_id);
                if (idx !== -1) {
                    const currentProfit = parseFloat(contract.profit || 0);
                    botState.activeContracts[idx].profit = currentProfit;

                    if (contract.contract_id === botState.currentContractId) {
                        botState.activeProfit = currentProfit;
                        botState.currentContractType = contract.contract_type;

                        // --- LÓGICA ASEGURADOR (SOLO SNIPER) ---
                        if (botState.activeStrategy === 'SNIPER') {
                            if (currentProfit > botState.currentMaxProfit) {
                                botState.currentMaxProfit = currentProfit;
                            }

                            // 1. ARMADO DE PROTECCIÓN (Log de aviso)
                            if (botState.currentMaxProfit >= 3.00 && botState.lastSlAssigned < 2.00) {
                                botState.lastSlAssigned = 2.00;
                                console.log(`🛡️ ASEGURADOR ARMADO: Profit llegó a $${botState.currentMaxProfit.toFixed(2)}. Protegiendo ganancia de $2.00...`);
                            } else if (botState.currentMaxProfit >= 2.00 && botState.lastSlAssigned < 1.00) {
                                botState.lastSlAssigned = 1.00;
                                console.log(`🛡️ ASEGURADOR ARMADO: Profit llegó a $${botState.currentMaxProfit.toFixed(2)}. Protegiendo ganancia de $1.00...`);
                            }

                            // 2. EJECUCIÓN DE VENTA (Si el profit cae del nivel protegido)
                            let thresholdToSell = null;
                            if (botState.lastSlAssigned === 2.00 && currentProfit <= 2.00) {
                                thresholdToSell = 2.00;
                            } else if (botState.lastSlAssigned === 1.00 && currentProfit <= 1.00) {
                                thresholdToSell = 1.00;
                            }

                            if (thresholdToSell !== null) {
                                console.log(`⚠️ ASEGURADOR DISPARADO: Profit cayó a $${currentProfit.toFixed(2)}. Cerrando para asegurar $${thresholdToSell.toFixed(2)}...`);
                                sellContract(contract.contract_id);
                            }
                        }
                    }
                }
            }

            if (contract && contract.is_sold) {
                const profit = parseFloat(contract.profit);
                botState.activeContracts = botState.activeContracts.filter(ac => ac.id !== contract.contract_id);
                if (botState.currentContractId === contract.contract_id) {
                    botState.currentContractId = botState.activeContracts.length > 0 ? botState.activeContracts[0].id : null;
                    botState.currentContractType = null;
                    botState.activeProfit = 0;
                    botState.currentMaxProfit = 0;
                    botState.lastSlAssigned = -12;
                }
                botState.totalTradesSession++;
                botState.pnlSession += profit;
                if (profit > 0) botState.winsSession++; else botState.lossesSession++;
                isBuying = false;
                ws.send(JSON.stringify({ balance: 1 }));
                const durationSeconds = (contract.sell_time || Math.floor(Date.now() / 1000)) - contract.date_start;
                const h = Math.floor(durationSeconds / 3600);
                const m = Math.floor((durationSeconds % 3600) / 60);
                const s = durationSeconds % 60;
                const durationStr = h > 0 ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`;

                botState.tradeHistory.unshift({
                    id: contract.contract_id,
                    type: contract.contract_type,
                    profit,
                    timestamp: new Date().toLocaleTimeString(),
                    duration: durationStr
                });
                if (botState.tradeHistory.length > 10) botState.tradeHistory.pop();
                saveState();

                botState.cooldownRemaining = 60; // Enfriamiento de 1 minuto solicitado
                const timer = setInterval(() => {
                    botState.cooldownRemaining--;
                    if (botState.cooldownRemaining <= 0) {
                        botState.cooldownRemaining = 0;
                        clearInterval(timer);
                        tickHistory = [];
                    }
                }, 1000);
            }
        }
    });

    ws.on('close', () => {
        botState.isConnectedToDeriv = false;
        botState.currentContractId = null;
        isBuying = false;
        setTimeout(connectDeriv, 5000);
    });
}

function sellContract(contractId) {
    if (isBuying) return; // Reutilizamos bloqueo
    isBuying = true;
    console.log(`💰 [ASEGURADOR] Vendiendo contrato ${contractId} para asegurar ganancias...`);
    ws.send(JSON.stringify({
        sell: contractId,
        price: 0 // 0 significa vender al precio de mercado actual
    }));
    setTimeout(() => { if (isBuying) isBuying = false; }, 3000);
}

function executeTrade(type) {
    if (isBuying) return;
    isBuying = true;
    const config = botState.activeStrategy === 'SNIPER' ? SNIPER_CONFIG : DYNAMIC_CONFIG;
    const safeAmt = Math.max(1, config.stake);

    console.log(`🚀 [${botState.activeStrategy}] Disparando: ${type} | Stake: $${safeAmt}`);
    const limitOrder = { take_profit: config.takeProfit };

    // Aplicar Stop Loss si está configurado (ya sea el blindado de Sniper o el nuevo de Dynamic)
    if (config.stopLoss) {
        limitOrder.stop_loss = config.stopLoss;
    }

    ws.send(JSON.stringify({
        buy: 1, price: safeAmt,
        parameters: {
            amount: safeAmt, basis: "stake", contract_type: type, currency: "USD",
            multiplier: config.multiplier, symbol: SYMBOL,
            limit_order: limitOrder
        }
    }));
    setTimeout(() => { if (isBuying) isBuying = false; }, 5000);
}

connectDeriv();
