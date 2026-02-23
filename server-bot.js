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
    stopLoss: 3.00,
    useFilters: false  // Filtros de Precisión ATR + Densidad de Ticks
};

// --- PARÁMETROS SNIPER V3 (TREND FOLLOWER) ---
const SNIPER_CONFIG = {
    stake: 20,
    takeProfit: 4.00,
    stopLoss: 12.00, // Protección Blindada
    multiplier: 100, // ✅ Mínimo válido para Gold en Deriv (x100, x200, x300, x500, x800)
    smaPeriod: 50,
    rsiPeriod: 14,
    rsiLow: 30,
    rsiHigh: 70,
    momentum: 5
};

// --- PARÁMETROS PM-40 OK (PROFESIONAL ORO) ---
const PM40_CONFIG = {
    stake: 10,
    takeProfit: 1.00,
    stopLoss: 2.00,
    multiplier: 100, // ✅ Mínimo válido para Gold en Deriv (x100, x200, x300, x500, x800)
    sma20Period: 20,
    sma40Period: 40,
    granularity: 60 // 1 minuto
};

// --- PARÁMETROS GOLD DYNAMIC (Momentum en ticks aplicado al Oro) ---
const GOLD_DYNAMIC_CONFIG = {
    stake: 10,
    takeProfit: 2.00,  // Config campeona del backtesting Enero 2026
    stopLoss: 3.00,
    multiplier: 100,   // FIJO — único válido para frxXAUUSD en Multiplier
    momentum: 5        // 5 ticks consecutivos en la misma dirección
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
    tradeHistory: [],
    dailyLossLimit: 5.0, // 5% de pérdida máxima diaria
    startBalanceDay: 0,
    isLockedByDrawdown: false,
    rsiValue: 50,
    pm40Setup: { active: false, side: null }
};

// --- CARGAR ESTADO ---
if (fs.existsSync(STATE_FILE)) {
    try {
        const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        botState = { ...botState, ...saved, isConnectedToDeriv: false, activeContracts: [], activeProfit: 0 };
        if (saved.DYNAMIC_CONFIG) DYNAMIC_CONFIG = { ...DYNAMIC_CONFIG, ...saved.DYNAMIC_CONFIG };
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
            DYNAMIC_CONFIG: DYNAMIC_CONFIG
        };
        fs.writeFileSync(STATE_FILE, JSON.stringify(dataToSave, null, 2));
    } catch (e) {
        console.error('⚠️ Error guardando el estado:', e);
    }
}

// --- CÁLCULOS TÉCNICOS ---
function calculateSMA(prices, period) {
    if (prices.length < period) return null;
    let sum = 0;
    for (let i = 0; i < period; i++) {
        sum += prices[prices.length - 1 - i];
    }
    return sum / period;
}

function calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) return 50;
    let gains = 0;
    let losses = 0;
    for (let i = prices.length - period; i < prices.length; i++) {
        let diff = prices[i] - prices[i - 1];
        if (diff >= 0) gains += diff; else losses -= diff;
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    let rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}

let ws;
let isBuying = false;
let cooldownTime = 0;
let tickHistory = [];
let candleHistory = []; // Velas M1
let candleHistoryH1 = []; // Velas H1 para filtro MTF

console.log('🚀 Iniciando Servidor Multi-Estrategia 24/7...');

// ==========================================
// SERVIDOR WEB (CONTROL REMOTO)
// ==========================================
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/status', (req, res) => {
    let activeConfig = SNIPER_CONFIG;
    if (botState.activeStrategy === 'DYNAMIC') activeConfig = DYNAMIC_CONFIG;
    else if (botState.activeStrategy === 'GOLD_DYNAMIC') activeConfig = GOLD_DYNAMIC_CONFIG;
    else if (botState.activeStrategy === 'PM40' || botState.activeStrategy === 'GOLD_MASTER') activeConfig = PM40_CONFIG;

    res.json({
        success: true,
        data: botState,
        config: activeConfig,
        isSniper: botState.activeStrategy === 'SNIPER'
    });
});

// --- ENDPOINT: TOGGLE FILTROS EN TIEMPO REAL ---
app.post('/api/filters', (req, res) => {
    const { password, useFilters } = req.body;
    if (password !== WEB_PASSWORD) return res.status(401).json({ success: false, error: 'Contraseña incorrecta' });
    if (useFilters === undefined) return res.status(400).json({ success: false, error: 'Falta parámetro useFilters' });

    if (botState.activeStrategy === 'GOLD_DYNAMIC') GOLD_DYNAMIC_CONFIG.useFilters = Boolean(useFilters);
    else DYNAMIC_CONFIG.useFilters = Boolean(useFilters);

    saveState();
    return res.json({ success: true, useFilters: Boolean(useFilters), message: `Filtros actualizados` });
});

app.post('/api/control', (req, res) => {
    const { action, password, stake, takeProfit, multiplier, strategy } = req.body;
    console.log(`📩 RECIBIDO EN SERVIDOR: Acción=${action} | Estrategia=${strategy} | Stake=${stake}`);

    if (password !== WEB_PASSWORD) {
        return res.status(401).json({ success: false, error: 'Contraseña incorrecta' });
    }

    if (strategy && (strategy === 'DYNAMIC' || strategy === 'SNIPER' || strategy === 'GOLD_MASTER' || strategy === 'PM40' || strategy === 'GOLD_DYNAMIC')) {
        if (botState.isRunning && botState.activeStrategy !== strategy) {
            console.log(`⚠️ INTENTO DE CAMBIO BLOQUEADO: No se puede cambiar a ${strategy} mientras ${botState.activeStrategy} está en ejecución.`);
            return res.status(400).json({ success: false, error: `El bot ya está corriendo en modo ${botState.activeStrategy}. Deténlo para cambiar.` });
        } else {
            botState.activeStrategy = strategy;
            saveState();
            console.log(`🔄 ESTRATEGIA SELECCIONADA: ${strategy}`);

            // Si cambiamos a GOLD_MASTER (o antiguo PM40), re-suscribirse a candles
            if ((strategy === 'GOLD_MASTER' || strategy === 'PM40') && ws && botState.isConnectedToDeriv) {
                ws.send(JSON.stringify({ ticks: SYMBOL, subscribe: 1 }));
                ws.send(JSON.stringify({ ohlc: SYMBOL, granularity: PM40_CONFIG.granularity, subscribe: 1 }));
            }
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
        botState.connectionError = null; // Limpiamos error al cambiar mercado
        saveState();
        console.log(`🌍 MERCADO CAMBIADO A: ${SYMBOL === 'R_100' ? 'Volatility 100' : 'Oro (Gold)'}`);

        // Re-suscribirse limpiamente al nuevo símbolo
        if (ws && botState.isConnectedToDeriv) {
            ws.send(JSON.stringify({ forget_all: 'ticks' }));
            ws.send(JSON.stringify({ forget_all: 'candles' })); // ✅ 'candles' es el tipo correcto para OHLC en Deriv API
            setTimeout(() => {
                if (ws && botState.isConnectedToDeriv) {
                    ws.send(JSON.stringify({ ticks: SYMBOL, subscribe: 1 }));
                    if (botState.activeStrategy === 'GOLD_MASTER' || botState.activeStrategy === 'PM40') {
                        ws.send(JSON.stringify({ ticks_history: SYMBOL, end: 'latest', count: 100, style: 'candles', granularity: 60, subscribe: 1 }));
                        ws.send(JSON.stringify({ ticks_history: SYMBOL, end: 'latest', count: 100, style: 'candles', granularity: 3600, subscribe: 1 }));
                    }
                }
            }, 400);
        }

        // Si solo estamos cambiando el símbolo sin otra acción, respondemos aquí
        if (!action) {
            return res.json({ success: true, message: `Mercado cambiado a ${targetSymbol === 'R_100' ? 'V100' : 'Oro'}` });
        }
    }

    if (action === 'START') {
        botState.isRunning = true;
        saveState();

        let actualStake = botState.activeStrategy === 'SNIPER' ? SNIPER_CONFIG.stake : (stake || DYNAMIC_CONFIG.stake);

        if (botState.activeStrategy === 'GOLD_DYNAMIC') {
            if (stake) GOLD_DYNAMIC_CONFIG.stake = Number(stake);
            if (takeProfit) GOLD_DYNAMIC_CONFIG.takeProfit = Number(takeProfit);
            if (req.body.stopLoss !== undefined) GOLD_DYNAMIC_CONFIG.stopLoss = Number(req.body.stopLoss) || 3.00;
            if (req.body.momentum) GOLD_DYNAMIC_CONFIG.momentum = Number(req.body.momentum);
            GOLD_DYNAMIC_CONFIG.multiplier = 100; // SIEMPRE FORZADO PARA ORO
            actualStake = GOLD_DYNAMIC_CONFIG.stake;
            if (req.body.useFilters !== undefined) GOLD_DYNAMIC_CONFIG.useFilters = Boolean(req.body.useFilters);
        }

        if (botState.activeStrategy === 'DYNAMIC') {
            if (stake) DYNAMIC_CONFIG.stake = Number(stake);
            if (takeProfit) DYNAMIC_CONFIG.takeProfit = Number(takeProfit);
            if (multiplier) DYNAMIC_CONFIG.multiplier = Number(multiplier);
            if (req.body.momentum) DYNAMIC_CONFIG.momentum = Number(req.body.momentum);
            if (req.body.stopLoss !== undefined) {
                const slVal = Number(req.body.stopLoss);
                DYNAMIC_CONFIG.stopLoss = slVal > 0 ? slVal : null;
            }
            // Guardar preferencia de Filtros de Precisión
            if (req.body.useFilters !== undefined) {
                DYNAMIC_CONFIG.useFilters = Boolean(req.body.useFilters);
                console.log(`🎯 Filtros de Precisión: ${DYNAMIC_CONFIG.useFilters ? 'ACTIVADOS (ATR + Tick Density)' : 'DESACTIVADOS (Velocidad Máxima)'}`);
            }
        }

        console.log(`▶️ BOT ENCENDIDO: ${botState.activeStrategy} | Stake Real: $${actualStake}`);
        if (botState.activeStrategy === 'DYNAMIC') {
            console.log(`🎯 Filtros de Precisión: ${DYNAMIC_CONFIG.useFilters ? '✅ ACTIVADOS (ATR + Tick Density)' : '⏸️  DESACTIVADOS (Velocidad Máxima)'}`);
        }
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

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🌍 Módulo Web en puerto ${PORT}`));

// ==========================================
// NÚCLEO DEL BOT (DERIV)
// ==========================================
function connectDeriv() {
    const activeToken = process.env.DERIV_TOKEN;

    if (!activeToken) {
        console.error('❌ ERROR: No hay API Token configurado.');
        botState.isConnectedToDeriv = false;
        return;
    }

    ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

    ws.on('open', () => {
        console.log('✅ Conectado a Deriv API (Usando Token de Railway)');
        ws.send(JSON.stringify({ authorize: activeToken }));
    });

    ws.on('message', (data) => {
        const msg = JSON.parse(data);
        if (msg.error) {
            const errMsg = (msg.error.message || '').toLowerCase();
            // Ignorar errores de suscripción duplicada — son parte normal del ciclo de re-suscripción
            const isBenign = errMsg.includes('already subscribed') ||
                errMsg.includes('unrecognised request');
            if (!isBenign) {
                console.error(`⚠️ Error: ${msg.error.message}`);
            }
            botState.connectionError = isBenign ? null : msg.error.message;
            isBuying = false;

            // --- AUTO-CLEAN GHOST TRADES ON ERROR ---
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
            // Limpiar suscripciones anteriores antes de crear nuevas
            ws.send(JSON.stringify({ forget_all: 'ticks' }));
            ws.send(JSON.stringify({ forget_all: 'candles' })); // ✅ 'candles' es el tipo correcto para OHLC en Deriv API
            setTimeout(() => {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ ticks: SYMBOL, subscribe: 1 }));
                    if (botState.activeStrategy === 'GOLD_MASTER' || botState.activeStrategy === 'PM40') {
                        ws.send(JSON.stringify({ ticks_history: SYMBOL, end: 'latest', count: 100, style: 'candles', granularity: 60, subscribe: 1 }));
                        ws.send(JSON.stringify({ ticks_history: SYMBOL, end: 'latest', count: 100, style: 'candles', granularity: 3600, subscribe: 1 }));
                    }
                    ws.send(JSON.stringify({ balance: 1, subscribe: 1 }));
                    ws.send(JSON.stringify({ portfolio: 1 }));
                }
            }, 300);

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
            botState.connectionError = null; // Si llegan ticks, el mercado está vivo
            const quote = parseFloat(msg.tick.quote);
            tickHistory.push(quote);
            if (tickHistory.length > 200) tickHistory.shift();

            const now = new Date();
            const hour = now.getUTCHours();

            // Evaluamos la sesión solo para ORO, el Volatility 100 es 24/7.
            const isInsideSession = (SYMBOL === 'frxXAUUSD') ? (hour >= 11 && hour <= 21) : true;

            if (botState.isRunning && botState.isConnectedToDeriv && !botState.currentContractId && botState.cooldownRemaining === 0 && !isBuying && !botState.isLockedByDrawdown && isInsideSession) {

                const currentConfig = botState.activeStrategy === 'SNIPER' ? SNIPER_CONFIG :
                    (botState.activeStrategy === 'GOLD_DYNAMIC' ? GOLD_DYNAMIC_CONFIG :
                        ((botState.activeStrategy === 'PM40' || botState.activeStrategy === 'GOLD_MASTER') ? PM40_CONFIG : DYNAMIC_CONFIG));

                if (botState.activeStrategy !== 'PM40' && botState.activeStrategy !== 'GOLD_MASTER' && tickHistory.length >= currentConfig.momentum) {
                    const lastTicks = tickHistory.slice(-currentConfig.momentum);
                    const allDown = lastTicks.every((v, i) => i === 0 || v < lastTicks[i - 1]);
                    const allUp = lastTicks.every((v, i) => i === 0 || v > lastTicks[i - 1]);

                    let direction = null;

                    if (botState.activeStrategy === 'SNIPER') {
                        // --- LÓGICA TREND SNIPER V3 ---
                        const trend = calculateSMA(tickHistory, SNIPER_CONFIG.smaPeriod);
                        const rsi = calculateRSI(tickHistory, SNIPER_CONFIG.rsiPeriod);
                        if (trend && rsi) {
                            if (allUp && quote > trend && rsi < SNIPER_CONFIG.rsiHigh) direction = 'MULTUP';
                            if (allDown && quote < trend && rsi > SNIPER_CONFIG.rsiLow) direction = 'MULTDOWN';
                        }
                    } else {
                        // --- LÓGICA DINÁMICA ---
                        if (allDown) direction = 'MULTUP';
                        if (allUp) direction = 'MULTDOWN';

                        // --- FILTROS DE PRECISIÓN (ATR + Tick Density) ---
                        // Solo aplica en modo DYNAMIC o GOLD_DYNAMIC cuando está activado desde la UI
                        const activeFilters = botState.activeStrategy === 'GOLD_DYNAMIC' ? GOLD_DYNAMIC_CONFIG.useFilters : DYNAMIC_CONFIG.useFilters;

                        if (direction && activeFilters && candleHistory.length >= 15) {
                            // Filtro 1: ATR - la vela actual debe tener un rango mayor que el promedio
                            const ranges = candleHistory.slice(-14).map(c => c.high - c.low);
                            const atr = ranges.reduce((a, b) => a + b, 0) / ranges.length;
                            const latestCandle = candleHistory[candleHistory.length - 1];
                            const currentRange = latestCandle ? (latestCandle.high - latestCandle.low) : 0;
                            const atrPass = currentRange >= atr * 1.2;

                            // Filtro 2: Densidad de Ticks (Body Ratio de la última vela)
                            const candleBody = latestCandle ? Math.abs(latestCandle.close - latestCandle.open) : 0;
                            const bodyRatio = currentRange > 0 ? candleBody / currentRange : 0;
                            const pastBodyRatios = candleHistory.slice(-10).map(c => {
                                const r = c.high - c.low;
                                return r > 0 ? Math.abs(c.close - c.open) / r : 0;
                            });
                            const avgBodyRatio = pastBodyRatios.reduce((a, b) => a + b, 0) / pastBodyRatios.length;
                            const tickPass = bodyRatio >= 0.55 && bodyRatio >= avgBodyRatio * 1.1;

                            if (!atrPass || !tickPass) {
                                console.log(`🚫 FILTRO: Señal ${direction === 'MULTUP' ? 'CALL' : 'PUT'} rechazada | ATR: ${atrPass ? '✅' : '❌'} | Tick: ${tickPass ? '✅' : '❌'}`);
                                direction = null; // Señal rechazada por filtros
                            } else {
                                console.log(`✅ FILTRO: Señal aprobada | ATR: ✅ | Tick: ✅ → Disparando trade`);
                            }
                        }
                    }

                    if (direction) executeTrade(direction);
                }
            }
        }

        if (msg.msg_type === 'ohlc') {
            const candle = msg.ohlc;
            const open = parseFloat(candle.open);
            const high = parseFloat(candle.high);
            const low = parseFloat(candle.low);
            const close = parseFloat(candle.close);
            const entry = { open, high, low, close, epoch: candle.epoch };

            if (candle.granularity === 3600) {
                // MANEJO VELAS H1 (Filtro Profesional)
                if (candleHistoryH1.length > 0 && candleHistoryH1[candleHistoryH1.length - 1].epoch === candle.epoch) {
                    candleHistoryH1[candleHistoryH1.length - 1] = entry;
                } else {
                    candleHistoryH1.push(entry);
                }
                if (candleHistoryH1.length > 50) candleHistoryH1.shift();
                return; // No procesar lógica de disparo con velas H1
            }

            // --- MANEJO VELAS M1 (Disparo) ---
            if (candleHistory.length > 0 && candleHistory[candleHistory.length - 1].epoch === candle.epoch) {
                candleHistory[candleHistory.length - 1] = entry;
            } else {
                candleHistory.push(entry);
            }
            if (candleHistory.length > 100) candleHistory.shift();

            const closes = candleHistory.map(c => c.close);

            // --- CÁLCULO RSI (Expert Filter) ---
            if (closes.length >= 14) {
                botState.rsiValue = calculateRSI(closes, 14);
            }

            // LÓGICA GOLD MASTER BIDIRECCIONAL + FILTRO PRO MTF
            if (botState.isRunning && (botState.activeStrategy === 'PM40' || botState.activeStrategy === 'GOLD_MASTER') && !botState.currentContractId && botState.cooldownRemaining === 0 && !isBuying && !botState.isLockedByDrawdown) {

                const hour = new Date().getUTCHours();
                if (hour < 11 || hour > 21) return; // Fuera de sesión profesional

                let h1Trend = 'NEUTRAL';
                if (candleHistoryH1.length >= 40) {
                    const closesH1 = candleHistoryH1.map(c => c.close);
                    const s20H1 = calculateSMA(closesH1, 20);
                    const s40H1 = calculateSMA(closesH1, 40);
                    if (s20H1 && s40H1) {
                        h1Trend = s20H1 > s40H1 ? 'UP' : 'DOWN';
                    }
                }

                if (candleHistory.length >= 40) {
                    const s20 = calculateSMA(closes, 20);
                    const s40 = calculateSMA(closes, 40);
                    const currentClose = candleHistory[candleHistory.length - 1].close;
                    const currentHigh = candleHistory[candleHistory.length - 1].high;
                    const currentLow = candleHistory[candleHistory.length - 1].low;

                    // --- LÓGICA CALL (COMPRA) ---
                    if (h1Trend === 'UP' && s20 > s40) {
                        if (currentLow <= s40 * 1.0002) {
                            botState.pm40Setup.active = true;
                            botState.pm40Setup.side = 'CALL';
                            botState.pm40Setup.resistance = currentHigh;
                        }
                        if (botState.pm40Setup.active && botState.pm40Setup.side === 'CALL' && currentClose > botState.pm40Setup.resistance && botState.rsiValue < 70) {
                            console.log(`🚀 [Expert Audit] Disparo CALL detectado: RSI ${botState.rsiValue.toFixed(1)}`);
                            executeTrade('CALL', 1.00, 1.60); // TP/SL Optimizados por Auditoría
                            botState.pm40Setup.active = false;
                        } else if (botState.pm40Setup.active && botState.pm40Setup.side === 'CALL' && currentClose < s40) {
                            botState.pm40Setup.active = false; // Invalidación
                        }
                    }

                    // --- LÓGICA PUT (VENTA) ---
                    else if (h1Trend === 'DOWN' && s20 < s40) {
                        if (currentHigh >= s40 * 0.9998) {
                            botState.pm40Setup.active = true;
                            botState.pm40Setup.side = 'PUT';
                            botState.pm40Setup.support = currentLow;
                        }
                        if (botState.pm40Setup.active && botState.pm40Setup.side === 'PUT' && currentClose < botState.pm40Setup.support && botState.rsiValue > 30) {
                            console.log(`📉 [Expert Audit] Disparo PUT detectado: RSI ${botState.rsiValue.toFixed(1)}`);
                            executeTrade('PUT', 1.00, 1.60);
                            botState.pm40Setup.active = false;
                        } else if (botState.pm40Setup.active && botState.pm40Setup.side === 'PUT' && currentClose > s40) {
                            botState.pm40Setup.active = false; // Invalidación
                        }
                    }
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

                // --- PROTECCIÓN DE DRAWDOWN DIARIO ---
                if (!botState.startBalanceDay) botState.startBalanceDay = botState.balance + Math.abs(profit);
                const currentLoss = botState.startBalanceDay - botState.balance;
                const maxAllowedLoss = botState.startBalanceDay * (botState.dailyLossLimit / 100);

                if (currentLoss >= maxAllowedLoss) {
                    botState.isRunning = false;
                    botState.isLockedByDrawdown = true;
                    console.log(`🧨 PROTECCIÓN DE PÁNICO: Se ha perdido el ${botState.dailyLossLimit}%. Bot desactivado para proteger capital.`);
                }

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

function executeTrade(type, customTP = null, customSL = null) {
    if (isBuying) return;
    isBuying = true;

    // --- CONFIGURACIÓN DINÁMICA DE LIMITES ---
    let actualStake, actualTP, actualSL, actualMult;

    if (botState.activeStrategy === 'SNIPER') {
        actualStake = SNIPER_CONFIG.stake;
        actualTP = SNIPER_CONFIG.takeProfit;
        actualSL = SNIPER_CONFIG.stopLoss;
        actualMult = SNIPER_CONFIG.multiplier;
    } else if (botState.activeStrategy === 'GOLD_DYNAMIC') {
        actualStake = GOLD_DYNAMIC_CONFIG.stake;
        actualTP = GOLD_DYNAMIC_CONFIG.takeProfit;
        actualSL = GOLD_DYNAMIC_CONFIG.stopLoss;
        actualMult = GOLD_DYNAMIC_CONFIG.multiplier;
    } else if (botState.activeStrategy === 'PM40' || botState.activeStrategy === 'GOLD_MASTER') {
        actualStake = PM40_CONFIG.stake;
        actualTP = PM40_CONFIG.takeProfit;
        actualSL = PM40_CONFIG.stopLoss;
        actualMult = PM40_CONFIG.multiplier;
    } else {
        actualStake = DYNAMIC_CONFIG.stake;
        actualTP = DYNAMIC_CONFIG.takeProfit;
        actualSL = DYNAMIC_CONFIG.stopLoss;
        actualMult = DYNAMIC_CONFIG.multiplier;
    }

    // Sobrescritura Pro (Resultados de la Auditoría Experta)
    if (customTP) actualTP = customTP;
    if (customSL) actualSL = customSL;

    // Mapeo Binario -> Multiplicador
    let contractType = type;
    if (type === 'CALL') contractType = 'MULTUP';
    if (type === 'PUT') contractType = 'MULTDOWN';

    const safeAmt = Math.max(1, actualStake);

    console.log(`🚀 [EXPERT DISPARO] ${type} (${contractType}) | Stake: $${safeAmt} | TP: $${actualTP} | SL: $${actualSL}`);
    const limitOrder = { take_profit: actualTP };

    if (actualSL) {
        limitOrder.stop_loss = actualSL;
    }

    ws.send(JSON.stringify({
        buy: 1, price: safeAmt,
        parameters: {
            amount: safeAmt, basis: "stake", contract_type: contractType, currency: "USD",
            multiplier: actualMult, symbol: SYMBOL,
            limit_order: limitOrder
        }
    }));
    setTimeout(() => { if (isBuying) isBuying = false; }, 5000);
}

connectDeriv();
