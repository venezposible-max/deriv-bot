const WebSocket = require('ws');
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// ==========================================
// CONFIGURACIÓN DEL BOT - MULTI-ESTRATEGIA
// ==========================================
const APP_ID = 1089;
let SYMBOL = 'frxXAGUSD'; // Plata (XAGUSD) - Estrategia GIB W/M
const STATE_FILE = path.join(__dirname, 'persistent-state.json');

// --- CONFIGURACIÓN DE ESTRATEGIA UNIFICADA (SNIPER PRO - TÉCNICA MAESTRA) ---
let SNIPER_CONFIG = {
    stake: 10,
    takeProfit: 19.00, // Basado en ratio 2:1 del backtest
    stopLoss: 9.50,
    multiplier: 200,
    smaPeriod: 50,
    smaLongPeriod: 200, // Filtro Mayor
    rsiPeriod: 14,
    rsiLow: 25,        // Ajustado (antes 20) para evitar agotamiento
    rsiHigh: 75,       // Ajustado (antes 80) para evitar agotamiento
    momentum: 5,       // Confirmación más sólida
    distLimit: 0.08,   // 🎯 PRECISIÓN EXTREMA (Filtro para mercado sucio)
    useHybrid: false,
    useTrailing: true  // --- ACTIVAR/DESACTIVAR TRAILING ---
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
    activeSymbol: 'frxXAGUSD', // Símbolo activo (Plata)
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
    marketStatus: 'OPEN',
    rsiValue: 50,
    dailyLossLimit: 5.0,
    startBalanceDay: 0,
    isLockedByDrawdown: false,
    rsiValue: 50,
    pm40Setup: { active: false, side: null },
    sessionDuration: 0,
    lastTickUpdate: Date.now(),
    tickIntervals: [],
    useHybrid: false,
    lastScanLogTime: 0,
    isReversing: false,
    activeStrategyName: 'SILVER INSTITUTIONAL GIB'
};

// --- CARGAR ESTADO ---
if (fs.existsSync(STATE_FILE)) {
    try {
        const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        botState = { ...botState, ...saved, isConnectedToDeriv: false, activeContracts: [], activeProfit: 0 };
        if (saved.SNIPER_CONFIG) {
            SNIPER_CONFIG = { ...SNIPER_CONFIG, ...saved.SNIPER_CONFIG };
        }
        if (saved.useHybrid !== undefined) botState.useHybrid = saved.useHybrid;

        // --- OPTIMIZACIÓN PARA PLATA (Garantía de símbolos) ---
        botState.activeSymbol = 'frxXAGUSD';
        SYMBOL = 'frxXAGUSD';

        // Aseguramos multiplicador mínimo de 750 si es menor (por seguridad en Step Index)
        if (SNIPER_CONFIG.multiplier < 750) SNIPER_CONFIG.multiplier = 750;

        console.log(`📦 ESTADO RECUPERADO: PLATA INSTITUTIONAL listo. Stop Loss Actual: $${SNIPER_CONFIG.stopLoss}`);
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

function calculateEMA(prices, period) {
    if (prices.length < period) return null;
    let k = 2 / (period + 1);
    let ema = 0;
    // Semilla inicial con SMA
    for (let i = 0; i < period; i++) ema += prices[i];
    ema = ema / period;
    // Aplicar fórmula EMA
    for (let i = period; i < prices.length; i++) {
        ema = (prices[i] * k) + (ema * (1 - k));
    }
    return ema;
}

function getMACD() {
    if (tickHistory.length < 30) return null;
    const ema12 = calculateEMA(tickHistory, 12);
    const ema26 = calculateEMA(tickHistory, 26);
    if (ema12 === null || ema26 === null) return null;

    const currentMacd = ema12 - ema26;

    // Simulación de señal rápida comparando con el estado anterior
    const prevEma12 = calculateEMA(tickHistory.slice(0, -1), 12);
    const prevEma26 = calculateEMA(tickHistory.slice(0, -1), 26);
    const prevMacd = (prevEma12 !== null && prevEma26 !== null) ? (prevEma12 - prevEma26) : null;

    return { current: currentMacd, prev: prevMacd };
}

let ws;
let isBuying = false;
let cooldownTime = 0;
let tickHistory = [];
let candleHistory = []; // Velas M1
let candleHistoryM5 = []; // Velas M5 para PLATA Institutional
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

    botState.activeSymbol = SYMBOL; // Refuerzo para la UI
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

// --- ENDPOINT: TOGGLE TRAILING STOP ---
app.post('/api/trailing', (req, res) => {
    const { password, useTrailing } = req.body;
    if (password !== WEB_PASSWORD) return res.status(401).json({ success: false, error: 'Contraseña incorrecta' });

    SNIPER_CONFIG.useTrailing = Boolean(useTrailing);
    saveState();
    return res.json({ success: true, useTrailing: Boolean(useTrailing), message: `Trailing Stop ${useTrailing ? 'ACTIVADO' : 'DESACTIVADO'}` });
});

app.post('/api/control', (req, res) => {
    const { action, password, stake, takeProfit, multiplier, momentum, stopLoss, distLimit, symbol } = req.body;

    if (password !== WEB_PASSWORD) {
        return res.status(401).json({ success: false, error: 'Contraseña incorrecta' });
    }

    // --- CAMBIO DE SÍMBOLO ---
    if (symbol && (symbol === 'R_100' || symbol === 'frxXAUUSD' || symbol === 'frxXAGUSD' || symbol === 'stpRNG')) {
        if (botState.isRunning && botState.activeSymbol !== symbol) {
            return res.status(400).json({ success: false, error: "Detén el bot para cambiar de mercado." });
        }

        botState.activeSymbol = symbol;
        SYMBOL = symbol;
        botState.connectionError = null;
        botState.activeStrategy = 'SNIPER'; // Forzar Sniper por ahora
        saveState();

        if (ws && botState.isConnectedToDeriv) {
            ws.send(JSON.stringify({ forget_all: 'ticks' }));
            ws.send(JSON.stringify({ forget_all: 'candles' }));
            setTimeout(() => {
                if (ws && botState.isConnectedToDeriv) {
                    ws.send(JSON.stringify({ ticks: SYMBOL, subscribe: 1 }));
                    ws.send(JSON.stringify({ ticks_history: SYMBOL, end: 'latest', count: 100, style: 'candles', granularity: 60, subscribe: 1 }));
                    ws.send(JSON.stringify({ ticks_history: SYMBOL, end: 'latest', count: 100, style: 'candles', granularity: 300, subscribe: 1 })); // M5 para PLATA GIB
                    ws.send(JSON.stringify({ ticks_history: SYMBOL, end: 'latest', count: 100, style: 'candles', granularity: 3600, subscribe: 1 }));
                }
            }, 400);
        }

        const marketName = symbol === 'stpRNG' ? 'Step Index' : (symbol === 'R_100' ? 'V100' : (symbol === 'frxXAUUSD' ? 'Oro' : 'Plata'));
        return res.json({ success: true, message: `Mercado cambiado a ${marketName}` });
    }

    if (action === 'START') {
        botState.isRunning = true;
        botState.isLockedByDrawdown = false;
        botState.activeStrategy = 'SNIPER';

        if (stake) SNIPER_CONFIG.stake = Number(stake);
        if (takeProfit) SNIPER_CONFIG.takeProfit = Number(takeProfit);
        if (multiplier) SNIPER_CONFIG.multiplier = Number(multiplier);
        if (momentum) SNIPER_CONFIG.momentum = Number(momentum);
        if (stopLoss !== undefined) SNIPER_CONFIG.stopLoss = Math.abs(Number(stopLoss));
        if (distLimit) SNIPER_CONFIG.distLimit = Number(distLimit);

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

            if (errMsg.includes('market is presently closed')) {
                botState.marketStatus = 'CLOSED';
                botState.connectionError = null; // No lo tratamos como error de conexión
                return; // Silencio, solo actualizamos estado
            }

            if (!isBenign) {
                console.error(`⚠️ Error de Deriv: ${msg.error.message}`);
            }

            // --- PROTECCIÓN CONTRA EL LÍMITE DE 100 CONTRATOS ---
            if (errMsg.includes('100 contracts') || errMsg.includes('more than 100')) {
                console.log('🛑 LÍMITE ALCANZADO: Tienes 100 o más contratos abiertos en tu cuenta. Activando Cooldown de Seguridad (120s).');
                botState.cooldownRemaining = 120; // 2 minutos de calma
                const timer = setInterval(() => {
                    if (botState.cooldownRemaining > 0) botState.cooldownRemaining--;
                    else clearInterval(timer);
                }, 1000);
            }

            botState.connectionError = isBenign ? null : msg.error.message;

            // Si es un error real, esperamos 2 segundos antes de permitir otra compra
            setTimeout(() => { isBuying = false; }, 2000);

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
            if (!botState.startBalanceDay || botState.startBalanceDay === 0) {
                botState.startBalanceDay = botState.balance;
            }
            botState.marketStatus = 'OPEN'; // Reset al autorizar
            console.log(`✅ DERIV CONECTADO - Usuario: ${msg.authorize.fullname || 'Trader'} | Saldo inicial: $${botState.balance}`);

            // --- CALENTAMIENTO INSTANTÁNEO (WARM START) ---
            console.log(`🚀 Solicitando historial de ticks para arranque inmediato...`);
            ws.send(JSON.stringify({
                ticks_history: SYMBOL,
                count: 3000,
                end: 'latest',
                style: 'ticks'
            }));

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
                    ws.send(JSON.stringify({ ticks_history: SYMBOL, end: 'latest', count: 100, style: 'candles', granularity: 300, subscribe: 1 })); // M5 para PLATA GIB
                    ws.send(JSON.stringify({ ticks_history: SYMBOL, end: 'latest', count: 100, style: 'candles', granularity: 3600, subscribe: 1 }));
                    ws.send(JSON.stringify({ balance: 1, subscribe: 1 }));
                    ws.send(JSON.stringify({ portfolio: 1 }));
                }
            }, 300);

            // --- SYNC PERIODICO Y PING KEEP-ALIVE (Evitar desconexiones) ---
            if (global.syncTimer) clearInterval(global.syncTimer);
            global.syncTimer = setInterval(() => {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ ping: 1 }));
                    ws.send(JSON.stringify({ portfolio: 1 }));
                }
            }, 15000); // Cada 15 segundos reconciliamos y mantenemos vivo el socket
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
                const isCorrectSymbol = c.symbol === SYMBOL ||
                    ((SYMBOL === 'frxXAUUSD' || SYMBOL === 'frxXAGUSD') && c.symbol.includes(SYMBOL.replace('frx', '')));
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

        // --- MANEJO DE HISTORIAL PARA WARM START ---
        if (msg.msg_type === 'history') {
            tickHistory = msg.history.prices;
            console.log(`📡 Memoria cargada instantáneamente: ${tickHistory.length} ticks. 🔥 SISTEMA LISTO.`);
        }

        if (msg.msg_type === 'tick') {
            botState.connectionError = null;
            botState.marketStatus = 'OPEN'; // Auto-detección: si hay precio, el mercado está abierto
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
            if (tickHistory.length > 3000) tickHistory.shift(); // Aumentado para SMA 2000 (Vortex)

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

                        // --- TRAILING MAESTRO (Escalón $0.50 | Protección $0.50) ---
                        if (SNIPER_CONFIG.useTrailing && botState.currentMaxProfit >= 0.50) {
                            const currentStep = Math.floor(botState.currentMaxProfit / 0.50) * 0.50;
                            const newFloor = currentStep - 0.30; // Protegemos $0.20 al tocar los $0.50

                            if (newFloor > botState.lastSlAssigned) {
                                botState.lastSlAssigned = newFloor;
                                console.log(`🛡️ MASTER TRAILING: Escalón $${currentStep.toFixed(2)} -> Piso $${newFloor.toFixed(2)}`);
                            }
                        }

                        // Ejecutar Cierre Inmediato (Sin esperar al segundo de Deriv)
                        if (SNIPER_CONFIG.useTrailing && botState.lastSlAssigned > 0 && liveProfit <= botState.lastSlAssigned) {
                            console.log(`⚡ [ULTRA-FAST] Trailing Activado: Venta en $${liveProfit.toFixed(2)} | Piso: $${botState.lastSlAssigned.toFixed(2)}`);
                            sellContract(botState.currentContractId);
                        }

                        // --- MODO ALPHA: STOP & REVERSE (Giro de Posición) ---
                        if (SNIPER_CONFIG.useHybrid && liveProfit <= -SNIPER_CONFIG.stopLoss && !botState.isReversing) {
                            console.log(`⚔️ [MODO ALPHA] Stop Loss de -$${Math.abs(liveProfit).toFixed(2)} | ¡GIRANDO POSICIÓN AL INSTANTE!`);
                            botState.isReversing = true;
                            const reverseType = (activeContract.type === 'MULTUP' || activeContract.type === 'CALL') ? 'PUT' : 'CALL';

                            // Cierre forzado inmediato bypass de isBuying local
                            ws.send(JSON.stringify({ sell: botState.currentContractId, price: 0 }));

                            // Liberamos isBuying para que executeTrade pueda disparar
                            isBuying = false;

                            // Pequeña espera para asegurar que el contrato anterior se cierre antes de abrir el nuevo
                            setTimeout(() => {
                                executeTrade(reverseType);
                                // El reset de isReversing ocurre DESPUÉS del disparo
                                setTimeout(() => { botState.isReversing = false; }, 2000);
                            }, 800);
                        }
                    }
                }
            }

            const nowDate = new Date();
            const hour = nowDate.getUTCHours();

            // Evaluamos la sesión solo para ORO/PLATA, el Volatility 100 es 24/7.
            const isInsideSession = (SYMBOL === 'frxXAUUSD' || SYMBOL === 'frxXAGUSD') ? (hour >= 11 && hour <= 21) : true;

            // --- LÓGICA SNIPER PRO (ÚNICA) ---
            if (botState.isRunning && botState.activeStrategy === 'SNIPER' && !botState.currentContractId && botState.cooldownRemaining === 0 && !isBuying && !botState.isLockedByDrawdown && isInsideSession) {
                let direction = null;
                const currentConfig = SNIPER_CONFIG;

                // Log de Escaneo (Cada 30 segundos para no saturar)
                const now = Date.now();
                if (now - botState.lastScanLogTime > 30000) {
                    const trendVortex = calculateSMA(tickHistory, 2000);
                    const rsi7 = calculateRSI(tickHistory, 7);
                    const distStr = trendVortex ? `${(Math.abs(quote - trendVortex) / trendVortex * 100).toFixed(3)}%` : `Cargando Memoria (${tickHistory.length}/2000)`;
                    console.log(`🔍 VORTEX SCAN [${SYMBOL}]: RSI7: ${rsi7?.toFixed(1) || '--'} | Dist: ${distStr} | Memoria: ${tickHistory.length >= 2000 ? 'LISTO ✅' : '⚡ Llenando...'}`);
                    botState.lastScanLogTime = now;
                }

                if (tickHistory.length >= currentConfig.momentum) {
                    const lastTicks = tickHistory.slice(-currentConfig.momentum);
                    const allDown = lastTicks.every((v, i) => i === 0 || v < lastTicks[i - 1]);
                    const allUp = lastTicks.every((v, i) => i === 0 || v > lastTicks[i - 1]);

                    if (allUp || allDown) {
                        // Log de pre-señal
                        // console.log(`⚡ MOMENTUM DETECTADO (${allUp ? 'UP' : 'DOWN'}): Validando filtros técnicos...`);
                    }

                    if (SNIPER_CONFIG.useHybrid) {
                        const sma = calculateSMA(tickHistory, SNIPER_CONFIG.smaPeriod);
                        const rsi = calculateRSI(tickHistory, SNIPER_CONFIG.rsiPeriod);
                        if (sma && rsi) {
                            const distPct = Math.abs(quote - sma) / sma * 100;

                            // Decisión 1: SNIPER (Cerca de la media)
                            if (distPct < 0.10 && rsi >= 40 && rsi <= 60) {
                                const ranges = candleHistory.slice(-14).map(c => c.high - c.low);
                                const atr = ranges.reduce((a, b) => a + b, 0) / ranges.length;
                                const latestCandle = candleHistory[candleHistory.length - 1];
                                const currentRange = latestCandle ? (latestCandle.high - latestCandle.low) : 0;

                                if (currentRange >= atr * 1.5) {
                                    if (allUp) { direction = 'MULTUP'; console.log(`🎯 TARGET LOCKED: Confirmada señal SNIPER ALCISTA (RSI: ${rsi.toFixed(1)})`); }
                                    if (allDown) { direction = 'MULTDOWN'; console.log(`🎯 TARGET LOCKED: Confirmada señal SNIPER BAJISTA (RSI: ${rsi.toFixed(1)})`); }
                                }
                            }
                            // Decisión 2: DINÁMICO (Lejos de la media - MODO ALPHA)
                            else if (distPct > 0.20) {
                                if (allUp && rsi > 75) { direction = 'MULTDOWN'; console.log(`⚔️ MODO ALPHA: Sobre-extensión detectada (RSI: ${rsi.toFixed(1)}). Disparando REVERSIÓN.`); }
                                if (allDown && rsi < 25) { direction = 'MULTUP'; console.log(`⚔️ MODO ALPHA: Sobre-extensión detectada (RSI: ${rsi.toFixed(1)}). Disparando REVERSIÓN.`); }
                            }
                        }
                    } else if (SYMBOL === 'frxXAGUSD') {
                        // --- ESTRATEGIA EXCLUSIVA PLATA: INSTITUTIONAL GIB (W/M PATTERN) ---
                        if (candleHistoryM5 && candleHistoryM5.length >= 40) {
                            let pivotsL = [], pivotsH = [];
                            // Escaneo de Pivotes M5 (Últimas 40 velas)
                            for (let j = candleHistoryM5.length - 2; j > candleHistoryM5.length - 35; j--) {
                                const prev = candleHistoryM5[j - 1], cur = candleHistoryM5[j], next = candleHistoryM5[j + 1];
                                if (!prev || !next) continue;
                                if (cur.low < prev.low && cur.low < next.low) pivotsL.push({ price: cur.low, index: j });
                                if (cur.high > prev.high && cur.high > next.high) pivotsH.push({ price: cur.high, index: j });
                            }

                            if (pivotsL.length >= 2 && pivotsH.length >= 1) {
                                const l2 = pivotsL[0].price, l1 = pivotsL[1].price, hh = pivotsH[0].price;
                                // PATRÓN W (Higher Low + Breakout)
                                if (l2 > l1 && quote > hh && pivotsL[0].index > pivotsH[0].index && pivotsH[0].index > pivotsL[1].index) {
                                    const distPct = Math.abs(quote - l2) / quote;
                                    let slAmt = (SNIPER_CONFIG.stopLoss > 0) ? SNIPER_CONFIG.stopLoss : SNIPER_CONFIG.stake * SNIPER_CONFIG.multiplier * (distPct + 0.0001);
                                    let tpAmt = (SNIPER_CONFIG.takeProfit > 0) ? SNIPER_CONFIG.takeProfit : slAmt * 2;
                                    if (slAmt >= SNIPER_CONFIG.stake) slAmt = SNIPER_CONFIG.stake * 0.95;
                                    direction = 'MULTUP';
                                    console.log(`🥇 GOLD W-PATTERN: Higher Low detectado (${l2} > ${l1}). Disparando Breakout!`);
                                    executeTrade(direction, parseFloat(tpAmt.toFixed(2)), parseFloat(slAmt.toFixed(2)));
                                    direction = null; // Mark handled
                                }
                            }

                            if (!direction && pivotsH.length >= 2 && pivotsL.length >= 1) {
                                const h2 = pivotsH[0].price, h1 = pivotsH[1].price, ll = pivotsL[0].price;
                                // PATRÓN M (Lower High + Breakout)
                                if (h2 < h1 && quote < ll && pivotsH[0].index > pivotsL[0].index && pivotsL[0].index > pivotsH[1].index) {
                                    const distPct = Math.abs(quote - h2) / quote;
                                    let slAmt = (SNIPER_CONFIG.stopLoss > 0) ? SNIPER_CONFIG.stopLoss : SNIPER_CONFIG.stake * SNIPER_CONFIG.multiplier * (distPct + 0.0001);
                                    let tpAmt = (SNIPER_CONFIG.takeProfit > 0) ? SNIPER_CONFIG.takeProfit : slAmt * 2;
                                    if (slAmt >= SNIPER_CONFIG.stake) slAmt = SNIPER_CONFIG.stake * 0.95;
                                    direction = 'MULTDOWN';
                                    console.log(`🥇 GOLD M-PATTERN: Lower High detectado (${h2} < ${h1}). Disparando Breakout!`);
                                    executeTrade(direction, parseFloat(tpAmt.toFixed(2)), parseFloat(slAmt.toFixed(2)));
                                    direction = null;
                                }
                            }
                        }
                    } else {
                        const trendVortex = calculateSMA(tickHistory, 2000);
                        const rsi7 = calculateRSI(tickHistory, 7);
                        const macd = getMACD();

                        if (trendVortex && rsi7 && macd && macd.prev !== null) {
                            const distPct = Math.abs(quote - trendVortex) / trendVortex * 100;

                            // --- DETECTOR DE EXPLOSIÓN VORTEX (3 ticks vs 10 previos) ---
                            const move3 = Math.abs(tickHistory[tickHistory.length - 1] - tickHistory[tickHistory.length - 4]);
                            let sumPrevDiffs = 0;
                            const startIdx = tickHistory.length - 13;
                            for (let j = startIdx; j < tickHistory.length - 4; j++) {
                                sumPrevDiffs += Math.abs(tickHistory[j + 1] - tickHistory[j]);
                            }
                            const avgMove10 = sumPrevDiffs / 9;
                            const isExplosion = move3 > (avgMove10 * 2.5); // Multiplicador Vortex

                            // --- FILTRO DE ENTRADA QUIRÚRGICA ---
                            if (isExplosion && distPct < SNIPER_CONFIG.distLimit) {
                                if (allUp && quote > trendVortex && macd.current > macd.prev && rsi7 < 80) {
                                    direction = 'MULTUP';
                                    console.log(`🌀 VORTEX DETECTED: Disparando UP (Vol: ${move3.toFixed(3)} | RSI7: ${rsi7.toFixed(1)})`);
                                }
                                if (allDown && quote < trendVortex && macd.current < macd.prev && rsi7 > 20) {
                                    direction = 'MULTDOWN';
                                    console.log(`🌀 VORTEX DETECTED: Disparando DOWN (Vol: ${move3.toFixed(3)} | RSI7: ${rsi7.toFixed(1)})`);
                                }
                            }
                        }
                    }

                    if (direction) executeTrade(direction);
                }
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

            if (candle.granularity === 300) {
                // MANEJO VELAS M5 (Plata GIB)
                if (candleHistoryM5.length > 0 && candleHistoryM5[candleHistoryM5.length - 1].epoch === candle.epoch) {
                    candleHistoryM5[candleHistoryM5.length - 1] = entry;
                } else {
                    candleHistoryM5.push(entry);
                }
                if (candleHistoryM5.length > 100) candleHistoryM5.shift();
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

                            // --- TRAILING MAESTRO (Sync) ---
                            if (SNIPER_CONFIG.useTrailing && botState.currentMaxProfit >= 0.50) {
                                const currentStep = Math.floor(botState.currentMaxProfit / 0.50) * 0.50;
                                const newFloor = currentStep - 0.30; // Protegemos $0.20 al tocar los $0.50

                                if (newFloor > botState.lastSlAssigned) {
                                    botState.lastSlAssigned = newFloor;
                                    console.log(`🛡️ MASTER TRAILING PORTFOLIO: Piso $${newFloor.toFixed(2)}`);
                                }
                            }

                            // CIERRE POR PROTECCIÓN (Si el profit cae del nivel protegido)
                            if (SNIPER_CONFIG.useTrailing && botState.lastSlAssigned > 0 && currentProfit <= botState.lastSlAssigned) {
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
                botState.isReversing = false;

                // --- PROTECCIÓN DE DRAWDOWN DIARIO SEGURO (DESHABILITADO POR USUARIO) ---
                // const maxAllowedLoss = botState.startBalanceDay * (botState.dailyLossLimit / 100);
                // if (botState.pnlSession <= -maxAllowedLoss) {
                //     botState.isRunning = false;
                //     botState.isLockedByDrawdown = true;
                //     console.log(`🧨 PROTECCIÓN DE PÁNICO: LÍMITE ALCANZADO (DESACTIVADO PARA MODO CONTINUO)`);
                // }

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

                // --- COOLDOWN INTELIGENTE Y REVERSO ALPHA (BACKUP) ---
                if (SNIPER_CONFIG.useHybrid && profit < 0 && !botState.isReversing) {
                    console.log(`⚔️ [ALPHA BACKUP] Detectada pérdida de $${Math.abs(profit).toFixed(2)}. Activando Reverso...`);
                    botState.isReversing = true;
                    isBuying = false;
                    botState.cooldownRemaining = 0;
                    const reverseType = (contract.contract_type === 'MULTUP' || contract.contract_type === 'CALL') ? 'PUT' : 'CALL';
                    setTimeout(() => {
                        executeTrade(reverseType);
                        setTimeout(() => { botState.isReversing = false; }, 2000);
                    }, 800);
                } else if (botState.isReversing) {
                    botState.cooldownRemaining = 0;
                    console.log("⚔️ REVERSIÓN ALPHA: Cooldown omitido para compensación inmediata.");
                } else {
                    botState.cooldownRemaining = 60; // Enfriamiento estándar
                }

                const timer = setInterval(() => {
                    if (botState.cooldownRemaining > 0) botState.cooldownRemaining--;
                    if (botState.cooldownRemaining <= 0) {
                        botState.cooldownRemaining = 0;
                        clearInterval(timer);
                        // tickHistory = []; // MEMORIA MANTENIDA PARA VORTEX 24/7
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
