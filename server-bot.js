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

// --- CONFIGURACIÓN DE ESTRATEGIA UNIFICADA (SNIPER PRO) ---
let SNIPER_CONFIG = {
    stake: 20,
    takeProfit: 10.00, // 🎯 Meta Alta
    stopLoss: 3.00,    // 🛡️ SL Corto para ALPHA
    multiplier: 40,
    smaPeriod: 50,
    rsiPeriod: 14,
    rsiLow: 30,
    rsiHigh: 70,
    momentum: 7,
    useHybrid: false
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
    activeStrategy: 'SNIPER', // Única estrategia permitida ahora
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
    currentContractType: null,
    lastTradeTime: null,
    cooldownRemaining: 0,
    customToken: null,
    connectionError: null,
    tradeHistory: [],
    dailyLossLimit: 5.0,
    startBalanceDay: 0,
    isLockedByDrawdown: false,
    rsiValue: 50,
    pm40Setup: { active: false, side: null },
    sessionDuration: 0,
    lastTickUpdate: Date.now(),
    tickIntervals: [],
    useHybrid: false
};

// --- CARGAR ESTADO ---
if (fs.existsSync(STATE_FILE)) {
    try {
        const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        botState = { ...botState, ...saved, isConnectedToDeriv: false, activeContracts: [], activeProfit: 0 };
        if (saved.SNIPER_CONFIG) SNIPER_CONFIG = { ...SNIPER_CONFIG, ...saved.SNIPER_CONFIG };
        if (saved.useHybrid !== undefined) botState.useHybrid = saved.useHybrid;
        if (botState.activeSymbol) SYMBOL = botState.activeSymbol;
        console.log(`📦 ESTADO RECUPERADO: Estrategia=SNIPER | Mercado=${botState.activeSymbol} | Corriendo=${botState.isRunning}`);
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
            activeStrategy: 'SNIPER',
            isRunning: botState.isRunning,
            sessionDuration: botState.sessionDuration,
            SNIPER_CONFIG: SNIPER_CONFIG,
            useHybrid: botState.useHybrid,
            startBalanceDay: botState.startBalanceDay,
            isLockedByDrawdown: botState.isLockedByDrawdown,
            activeSymbol: botState.activeSymbol
        };
        fs.writeFileSync(STATE_FILE, JSON.stringify(dataToSave, null, 2));
    } catch (e) {
        console.error('⚠️ Error guardando el estado:', e);
    }
}

// --- CRONÓMETRO DE SESIÓN (TIEMPO EN EL AIRE) ---
setInterval(() => {
    if (botState.isRunning) {
        botState.sessionDuration = (botState.sessionDuration || 0) + 1;
    }
}, 1000);

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
    const activeConfig = SNIPER_CONFIG;

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

// --- ENDPOINT: TOGGLE ACELERACIÓN ---
app.post('/api/acceleration', (req, res) => {
    const { password, useAcceleration } = req.body;
    if (password !== WEB_PASSWORD) return res.status(401).json({ success: false, error: 'Contraseña incorrecta' });

    if (botState.activeStrategy === 'GOLD_DYNAMIC') GOLD_DYNAMIC_CONFIG.useAcceleration = Boolean(useAcceleration);
    else DYNAMIC_CONFIG.useAcceleration = Boolean(useAcceleration);

    saveState();
    return res.json({ success: true, useAcceleration: Boolean(useAcceleration), message: `Filtro de aceleración ${useAcceleration ? 'activado' : 'desactivado'}` });
});

// --- ENDPOINT: TOGGLE MODO HÍBRIDO ---
app.post('/api/hybrid', (req, res) => {
    const { password, useHybrid } = req.body;
    if (password !== WEB_PASSWORD) return res.status(401).json({ success: false, error: 'Contraseña incorrecta' });

    if (botState.activeStrategy === 'SNIPER') {
        SNIPER_CONFIG.useHybrid = Boolean(useHybrid);
        botState.useHybrid = Boolean(useHybrid);
    }

    saveState();
    return res.json({ success: true, useHybrid: Boolean(useHybrid), message: `Modo Híbrido ${useHybrid ? 'ACTIVADO' : 'DESACTIVADO'}` });
});

app.post('/api/control', (req, res) => {
    const { action, password, stake, takeProfit, multiplier, momentum, stopLoss, symbol } = req.body;

    if (password !== WEB_PASSWORD) {
        return res.status(401).json({ success: false, error: 'Contraseña incorrecta' });
    }

    // --- CAMBIO DE SÍMBOLO (ORO / V100) ---
    if (symbol && (symbol === 'R_100' || symbol === 'frxXAUUSD')) {
        if (botState.isRunning && botState.activeSymbol !== symbol) {
            return res.status(400).json({ success: false, error: "Detén el bot para cambiar de mercado." });
        }
        botState.activeSymbol = symbol;
        SYMBOL = symbol;
        botState.connectionError = null;
        botState.activeStrategy = 'SNIPER'; // Forzar Sniper
        saveState();

        if (ws && botState.isConnectedToDeriv) {
            ws.send(JSON.stringify({ forget_all: 'ticks' }));
            ws.send(JSON.stringify({ forget_all: 'candles' }));
            setTimeout(() => {
                if (ws && botState.isConnectedToDeriv) {
                    ws.send(JSON.stringify({ ticks: SYMBOL, subscribe: 1 }));
                    ws.send(JSON.stringify({ ticks_history: SYMBOL, end: 'latest', count: 100, style: 'candles', granularity: 60, subscribe: 1 }));
                    ws.send(JSON.stringify({ ticks_history: SYMBOL, end: 'latest', count: 100, style: 'candles', granularity: 3600, subscribe: 1 }));
                }
            }, 400);
        }
        return res.json({ success: true, message: `Mercado cambiado a ${symbol === 'R_100' ? 'V100' : 'Oro'}` });
    }

    if (action === 'START') {
        botState.isRunning = true;
        botState.activeStrategy = 'SNIPER';

        if (stake) SNIPER_CONFIG.stake = Number(stake);
        if (takeProfit) SNIPER_CONFIG.takeProfit = Number(takeProfit);
        if (multiplier) SNIPER_CONFIG.multiplier = Number(multiplier);
        if (momentum) SNIPER_CONFIG.momentum = Number(momentum);
        if (stopLoss !== undefined) SNIPER_CONFIG.stopLoss = Number(stopLoss) || 3.00;

        saveState();
        console.log(`▶️ BOT ENCENDIDO: SNIPER PRO | Stake: $${SNIPER_CONFIG.stake}`);
        return res.json({ success: true, message: 'Bot Sniper Pro Activado', isRunning: true });
    }

    if (action === 'STOP') {
        botState.isRunning = false;
        saveState();
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
    botState.sessionDuration = 0; // REINICIAR TIEMPO EN EL AIRE
    botState.startBalanceDay = 0; // REINICIAR RIESGO DIARIO
    botState.isLockedByDrawdown = false; // LIBERAR BLOQUEO POR PÉRDIDA
    saveState();
    return res.json({ success: true, message: 'Estadísticas y tiempo reiniciados' });
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
        const tokenMasked = activeToken ? (activeToken.substring(0, 4) + '****') : 'MISSING';
        console.log(`✅ Socket Abierto. Autorizando con: ${botState.customToken ? 'Token Personalizado' : 'Token de Railway'} (${tokenMasked})`);

        if (!activeToken) {
            console.error('❌ ERROR CRÍTICO: No hay token para autorizar. El bot no podrá operar.');
            botState.connectionError = "Falta el token de Deriv";
            return;
        }

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
            setTimeout(() => {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ forget_all: 'candles' }));
                }
            }, 100);
            setTimeout(() => {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ ticks: SYMBOL, subscribe: 1 }));
                    // Siempre pedir historial de velas para filtros de precisión inmediatos
                    ws.send(JSON.stringify({ ticks_history: SYMBOL, end: 'latest', count: 100, style: 'candles', granularity: 60, subscribe: 1 }));
                    ws.send(JSON.stringify({ ticks_history: SYMBOL, end: 'latest', count: 100, style: 'candles', granularity: 3600, subscribe: 1 }));
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
                    botState.currentMaxProfit = 0;   // RESET CRÍTICO
                    botState.lastSlAssigned = -12;   // RESET CRÍTICO
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

            // --- CÁLCULO DE VELOCIDAD DE TICKS ---
            const nowMs = Date.now();
            if (botState.lastTickUpdate) {
                const interval = nowMs - botState.lastTickUpdate;
                botState.tickIntervals.push(interval);
                if (botState.tickIntervals.length > 20) botState.tickIntervals.shift();
            }
            botState.lastTickUpdate = nowMs;

            tickHistory.push(quote);
            if (tickHistory.length > 200) tickHistory.shift();

            // --- MONITOR ULTRA-RÁPIDO DE TRADES ACTIVOS (TICK-BY-TICK) ---
            if (botState.currentContractId && botState.isRunning) {
                const activeContract = botState.activeContracts.find(c => c.id === botState.currentContractId);
                if (activeContract && activeContract.entryPrice) {
                    let priceChangePct = (quote - activeContract.entryPrice) / activeContract.entryPrice;
                    if (activeContract.type === 'MULTDOWN' || activeContract.type === 'PUT') priceChangePct = -priceChangePct;
                    const liveProfit = priceChangePct * activeContract.multiplier * activeContract.stake;

                    // Actualizar estado para la UI (Rapidez visual)
                    botState.activeProfit = liveProfit;

                    if (botState.activeStrategy === 'SNIPER') {
                        // Actualizar Max Profit Real-Time
                        if (liveProfit > botState.currentMaxProfit) botState.currentMaxProfit = liveProfit;

                        // --- TRAILING DE ALTO RENDIMIENTO (Facturar $$$) ---
                        if (botState.currentMaxProfit >= 9.00 && botState.lastSlAssigned < 8.00) botState.lastSlAssigned = 8.00;
                        else if (botState.currentMaxProfit >= 6.00 && botState.lastSlAssigned < 4.50) botState.lastSlAssigned = 4.50;
                        else if (botState.currentMaxProfit >= 4.00 && botState.lastSlAssigned < 2.50) botState.lastSlAssigned = 2.50;
                        else if (botState.currentMaxProfit >= 2.50 && botState.lastSlAssigned < 1.00) botState.lastSlAssigned = 1.00; // 🎯 Primer piso real
                        else if (botState.currentMaxProfit >= 1.00 && botState.lastSlAssigned < 0.20) botState.lastSlAssigned = 0.20; // 🛡️ Solo cubre costo inicial

                        // Ejecutar Cierre Inmediato (Sin esperar al segundo de Deriv)
                        if (botState.lastSlAssigned > 0 && liveProfit <= botState.lastSlAssigned) {
                            console.log(`⚡ [ULTRA-FAST] Trailing Activado: Venta en $${liveProfit.toFixed(2)} | Piso: $${botState.lastSlAssigned.toFixed(2)}`);
                            sellContract(botState.currentContractId);
                        }

                        // --- MODO ALPHA: STOP & REVERSE (Giro de Posición) ---
                        if (SNIPER_CONFIG.useHybrid && liveProfit <= -SNIPER_CONFIG.stopLoss && !botState.isReversing) {
                            console.log(`⚔️ [MODO ALPHA] Stop Loss de -$${Math.abs(liveProfit).toFixed(2)} | ¡GIRANDO POSICIÓN AL INSTANTE!`);
                            botState.isReversing = true;
                            const reverseType = (activeContract.type === 'MULTUP' || activeContract.type === 'CALL') ? 'PUT' : 'CALL';

                            sellContract(botState.currentContractId);

                            // Pequeña espera para asegurar que el contrato anterior se cierre antes de abrir el nuevo
                            setTimeout(() => {
                                executeTrade(reverseType);
                                botState.isReversing = false;
                            }, 500);
                        }
                    }
                }
            }

            const nowDate = new Date();
            const hour = nowDate.getUTCHours();

            // Evaluamos la sesión solo para ORO, el Volatility 100 es 24/7.
            const isInsideSession = (SYMBOL === 'frxXAUUSD') ? (hour >= 11 && hour <= 21) : true;

            // --- LÓGICA SNIPER PRO (ÚNICA) ---
            if (botState.isRunning && botState.activeStrategy === 'SNIPER' && !botState.currentContractId && botState.cooldownRemaining === 0 && !isBuying && !botState.isLockedByDrawdown && isInsideSession) {
                let direction = null;
                const currentConfig = SNIPER_CONFIG;

                if (tickHistory.length >= currentConfig.momentum) {
                    const lastTicks = tickHistory.slice(-currentConfig.momentum);
                    const allDown = lastTicks.every((v, i) => i === 0 || v < lastTicks[i - 1]);
                    const allUp = lastTicks.every((v, i) => i === 0 || v > lastTicks[i - 1]);

                    if (SNIPER_CONFIG.useHybrid) {
                        // --- LÓGICA INTELIGENTE HÍBRIDA (Distancia + RSI) ---
                        const sma = calculateSMA(tickHistory, SNIPER_CONFIG.smaPeriod);
                        const rsi = calculateRSI(tickHistory, SNIPER_CONFIG.rsiPeriod);
                        if (sma && rsi) {
                            const distPct = Math.abs(quote - sma) / sma * 100;

                            // Decisión 1: SNIPER (Cerca de la media y RSI medio)
                            if (distPct < 0.10 && rsi >= 40 && rsi <= 60) {
                                const ranges = candleHistory.slice(-14).map(c => c.high - c.low);
                                const atr = ranges.reduce((a, b) => a + b, 0) / ranges.length;
                                const latestCandle = candleHistory[candleHistory.length - 1];
                                const currentRange = latestCandle ? (latestCandle.high - latestCandle.low) : 0;

                                if (currentRange >= atr * 1.5) {
                                    if (allUp) direction = 'MULTUP';
                                    if (allDown) direction = 'MULTDOWN';
                                }
                            }
                            // Decisión 2: DINÁMICO (Lejos de la media y RSI extremo)
                            else if (distPct > 0.20) {
                                if (allUp && rsi > 75) direction = 'MULTDOWN';
                                if (allDown && rsi < 25) direction = 'MULTUP';
                            }
                        }
                    } else {
                        // --- LÓGICA TREND SNIPER ORIGINAL ---
                        const trend = calculateSMA(tickHistory, SNIPER_CONFIG.smaPeriod);
                        const rsi = calculateRSI(tickHistory, SNIPER_CONFIG.rsiPeriod);
                        if (trend && rsi) {
                            if (allUp && quote > trend && rsi < SNIPER_CONFIG.rsiHigh) direction = 'MULTUP';
                            if (allDown && quote < trend && rsi > SNIPER_CONFIG.rsiLow) direction = 'MULTDOWN';
                        }
                    }
                }

                if (direction) executeTrade(direction);
            }
        }
        // --- MANEJO DE HISTORIAL DE VELAS ---
        if (msg.msg_type === 'history' || msg.msg_type === 'candles') {
            const sym = msg.echo_req.ticks_history;
            if (sym !== SYMBOL) return;

            const candles = msg.candles || (msg.history ? msg.history.times.map((t, i) => ({
                epoch: t,
                open: msg.history.prices[i],
                high: msg.history.prices[i],
                low: msg.history.prices[i],
                close: msg.history.prices[i]
            })) : []);

            candleHistory = candles;
            console.log(`📊 Velas cargadas [${SYMBOL}]: ${candleHistory.length}`);
        }

        if (msg.msg_type === 'ohlc') {
            const candle = msg.ohlc;
            if (candle.symbol !== SYMBOL) return; // VERIFICACIÓN DE SÍMBOLO CRÍTICA
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
                return;
            }

            // --- MANEJO VELAS M1 (Disparo + Filtros) ---
            if (candleHistory.length > 0 && candleHistory[candleHistory.length - 1].epoch === candle.epoch) {
                candleHistory[candleHistory.length - 1] = entry;
            } else {
                candleHistory.push(entry);
                if (candleHistory.length > 100) candleHistory.shift();
            }

            const closes = candleHistory.map(c => c.close);

            // --- CÁLCULO RSI (Expert Filter) ---
            if (closes.length >= 14) {
                botState.rsiValue = calculateRSI(closes, 14);
            }

        }

        if (msg.msg_type === 'buy') {
            isBuying = false;
            const newId = msg.buy.contract_id;
            botState.activeContracts.push({ id: newId, profit: 0 });
            botState.currentContractId = newId;
            botState.currentMaxProfit = 0;   // RESET AL COMPRAR
            botState.lastSlAssigned = -12;   // RESET AL COMPRAR
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

                    // ✅ GUARDAR DATOS PARA MONITORIZACIÓN ULTRA-RÁPIDA (TICK-BY-TICK)
                    if (!botState.activeContracts[idx].entryPrice && contract.entry_tick) {
                        botState.activeContracts[idx].entryPrice = parseFloat(contract.entry_tick);
                        botState.activeContracts[idx].type = contract.contract_type;
                        botState.activeContracts[idx].stake = parseFloat(contract.buy_price);
                        botState.activeContracts[idx].multiplier = contract.multiplier;
                    }

                    if (contract.contract_id === botState.currentContractId) {
                        botState.activeProfit = currentProfit;
                        botState.currentContractType = contract.contract_type;

                        // --- LÓGICA ASEGURADOR (SOLO SNIPER) ---
                        if (botState.activeStrategy === 'SNIPER') {
                            if (currentProfit > botState.currentMaxProfit) {
                                botState.currentMaxProfit = currentProfit;
                            }

                            // --- TRAILING DE ALTO RENDIMIENTO (Facturar $$$) ---
                            if (botState.currentMaxProfit >= 9.00 && botState.lastSlAssigned < 8.00) {
                                botState.lastSlAssigned = 8.00;
                                console.log(`🛡️ SNIPER TRAILING: Nivel 8 ($9.00) -> Piso $8.00`);
                            } else if (botState.currentMaxProfit >= 6.00 && botState.lastSlAssigned < 4.50) {
                                botState.lastSlAssigned = 4.50;
                                console.log(`🛡️ SNIPER TRAILING: Nivel 7 ($6.00) -> Piso $4.50`);
                            } else if (botState.currentMaxProfit >= 4.00 && botState.lastSlAssigned < 2.50) {
                                botState.lastSlAssigned = 2.50;
                                console.log(`🛡️ SNIPER TRAILING: Nivel 6 ($4.00) -> Piso $2.50`);
                            } else if (botState.currentMaxProfit >= 2.50 && botState.lastSlAssigned < 1.00) {
                                botState.lastSlAssigned = 1.00;
                                console.log(`🛡️ SNIPER TRAILING: Nivel 5 ($2.50) -> Piso $1.00`);
                            } else if (botState.currentMaxProfit >= 1.00 && botState.lastSlAssigned < 0.20) {
                                botState.lastSlAssigned = 0.20;
                                console.log(`🛡️ SNIPER TRAILING: Nivel 4 ($1.00) -> Piso $0.20`);
                            }

                            // CIERRE POR PROTECCIÓN (Si el profit cae del nivel protegido)
                            if (botState.lastSlAssigned > 0 && currentProfit <= botState.lastSlAssigned) {
                                console.log(`⚠️ TRAILING DISPARADO: Asegurando $${currentProfit.toFixed(2)} (Target Piso: $${botState.lastSlAssigned.toFixed(2)})`);
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
