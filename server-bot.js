const WebSocket = require('ws');
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// ==========================================
// CONFIGURACIÓN DEL BOT - MULTI-ESTRATEGIA
// ==========================================
const APP_ID = 1089;
const SYMBOL = 'R_100';
const STATE_FILE = path.join(__dirname, 'persistent-state.json');

// --- PARÁMETROS DINÁMICOS (ESTRATEGIA 1) ---
let DYNAMIC_CONFIG = {
    stake: 3,
    takeProfit: 0.30,
    multiplier: 40,
    momentum: 3
};

// --- PARÁMETROS SNIPER PRO (ESTRATEGIA 2 - FIJOS POR AHORA) ---
const SNIPER_CONFIG = {
    stake: 20,
    takeProfit: 4.00,
    multiplier: 40,
    smaPeriod: 25,
    rsiPeriod: 14,
    rsiLow: 35,
    rsiHigh: 65,
    momentum: 3
};

// Auth y Variables
const API_TOKEN = process.env.DERIV_TOKEN;
const WEB_PASSWORD = process.env.WEB_PASSWORD || "colina123";

if (!API_TOKEN) {
    console.error('❌ ERROR: No se encontró el token de Deriv. Define DERIV_TOKEN en Railway.');
}

// === ESTADO GLOBAL DEL BOT ===
let botState = {
    isRunning: true,
    activeStrategy: 'DYNAMIC', // 'DYNAMIC' o 'SNIPER'
    isConnectedToDeriv: false,
    balance: 0,
    totalTradesSession: 0,
    winsSession: 0,
    lossesSession: 0,
    pnlSession: 0,
    currentContractId: null,
    activeContracts: [],
    activeProfit: 0,
    lastTradeTime: null,
    tradeHistory: []
};

// --- CARGAR ESTADO ---
if (fs.existsSync(STATE_FILE)) {
    try {
        const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        botState = { ...botState, ...saved, isConnectedToDeriv: false, activeContracts: [], activeProfit: 0 };
        console.log('📦 ESTADO RECUPERADO: Historial y métricas cargadas.');
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
            activeStrategy: botState.activeStrategy
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
        } else {
            botState.activeStrategy = strategy;
            saveState();
            console.log(`🔄 ESTRATEGIA SELECCIONADA: ${strategy}`);
        }
    }

    if (action === 'START') {
        botState.isRunning = true;
        if (botState.activeStrategy === 'DYNAMIC') {
            if (stake) DYNAMIC_CONFIG.stake = Number(stake);
            if (takeProfit) DYNAMIC_CONFIG.takeProfit = Number(takeProfit);
            if (multiplier) DYNAMIC_CONFIG.multiplier = Number(multiplier);
        }
        return res.json({ success: true, message: `Bot ${botState.activeStrategy} Activado`, isRunning: true });
    }

    if (action === 'STOP') {
        botState.isRunning = false;
        return res.json({ success: true, message: 'Bot Pausado', isRunning: false });
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
    if (!API_TOKEN) return;
    ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

    ws.on('open', () => ws.send(JSON.stringify({ authorize: API_TOKEN })));

    ws.on('message', (data) => {
        const msg = JSON.parse(data);
        if (msg.error) { console.error(`⚠️ Error: ${msg.error.message}`); isBuying = false; return; }

        if (msg.msg_type === 'authorize') {
            botState.isConnectedToDeriv = true;
            botState.balance = msg.authorize.balance;
            console.log(`✅ DERIV CONECTADO - Usuario: ${msg.authorize.fullname || 'Trader'} | Saldo inicial: $${botState.balance}`);
            ws.send(JSON.stringify({ ticks: SYMBOL, subscribe: 1 }));
            ws.send(JSON.stringify({ balance: 1, subscribe: 1 }));
            ws.send(JSON.stringify({ portfolio: 1 }));
        }

        if (msg.msg_type === 'portfolio') {
            msg.portfolio.contracts.forEach(c => {
                if (c.symbol === SYMBOL && !c.expiry_time && !botState.activeContracts.find(ac => ac.id === c.contract_id)) {
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

            if (botState.isRunning && botState.isConnectedToDeriv && !botState.currentContractId && cooldownTime === 0 && !isBuying) {

                const currentConfig = botState.activeStrategy === 'SNIPER' ? SNIPER_CONFIG : DYNAMIC_CONFIG;

                if (tickHistory.length >= currentConfig.momentum) {
                    const lastTicks = tickHistory.slice(-currentConfig.momentum);
                    const allDown = lastTicks.every((v, i) => i === 0 || v < lastTicks[i - 1]);
                    const allUp = lastTicks.every((v, i) => i === 0 || v > lastTicks[i - 1]);

                    let direction = null;

                    if (botState.activeStrategy === 'SNIPER') {
                        // --- LÓGICA SNIPER PRO ---
                        const sma = calculateSMA(tickHistory, SNIPER_CONFIG.smaPeriod);
                        const rsi = calculateRSI(tickHistory, SNIPER_CONFIG.rsiPeriod);

                        if (sma && rsi) {
                            if (allDown && quote > sma && rsi < SNIPER_CONFIG.rsiLow) direction = 'MULTUP';
                            if (allUp && quote < sma && rsi > SNIPER_CONFIG.rsiHigh) direction = 'MULTDOWN';
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
                    botState.activeContracts[idx].profit = parseFloat(contract.profit || 0);
                    if (contract.contract_id === botState.currentContractId) botState.activeProfit = botState.activeContracts[idx].profit;
                }
            }

            if (contract && contract.is_sold) {
                const profit = parseFloat(contract.profit);
                botState.activeContracts = botState.activeContracts.filter(ac => ac.id !== contract.contract_id);
                if (botState.currentContractId === contract.contract_id) {
                    botState.currentContractId = botState.activeContracts.length > 0 ? botState.activeContracts[0].id : null;
                    botState.activeProfit = 0;
                }
                botState.totalTradesSession++;
                botState.pnlSession += profit;
                if (profit > 0) botState.winsSession++; else botState.lossesSession++;
                isBuying = false;
                ws.send(JSON.stringify({ balance: 1 }));
                botState.tradeHistory.unshift({ id: contract.contract_id, type: contract.contract_type, profit, timestamp: new Date().toLocaleTimeString() });
                if (botState.tradeHistory.length > 10) botState.tradeHistory.pop();
                saveState();

                cooldownTime = 15;
                const timer = setInterval(() => {
                    cooldownTime--;
                    if (cooldownTime <= 0) { clearInterval(timer); tickHistory = []; }
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

function executeTrade(type) {
    if (isBuying) return;
    isBuying = true;
    const config = botState.activeStrategy === 'SNIPER' ? SNIPER_CONFIG : DYNAMIC_CONFIG;
    const safeAmt = Math.max(1, config.stake);

    console.log(`🚀 [${botState.activeStrategy}] Disparando: ${type} | Stake: $${safeAmt}`);
    ws.send(JSON.stringify({
        buy: 1, price: safeAmt,
        parameters: {
            amount: safeAmt, basis: "stake", contract_type: type, currency: "USD",
            multiplier: config.multiplier, symbol: SYMBOL,
            limit_order: { take_profit: config.takeProfit }
        }
    }));
    setTimeout(() => { if (isBuying) isBuying = false; }, 5000);
}

connectDeriv();
