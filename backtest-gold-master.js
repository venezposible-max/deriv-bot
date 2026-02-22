const WebSocket = require('ws');

const APP_ID = 1089;
const SYMBOL = 'frxXAUUSD';
const API_TOKEN = process.env.DERIV_TOKEN || '';

// --- CONFIGURACIÓN GOLD MASTER ---
const STAKE = 10;
const TP = 1.00;
const SL = 1.60;
const SMA20_P = 20;
const SMA40_P = 40;
const RSI_P = 14;

let ws;
let candlesM1 = [];
let candlesH1 = [];
let botState = {
    balance: 1000,
    wins: 0,
    losses: 0,
    profit: 0,
    rsiValue: 50,
    setup: { active: false, side: null, resistance: null, support: null },
    activeTrade: null
};

let tradeHistory = [];
let startingBalance = 1000;

function calculateSMA(prices, period) {
    if (prices.length < period) return null;
    let sum = 0;
    for (let i = 0; i < period; i++) sum += prices[prices.length - 1 - i];
    return sum / period;
}

function calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) return 50;
    let gains = 0, losses = 0;
    for (let i = prices.length - period; i < prices.length; i++) {
        let diff = prices[i] - prices[i - 1];
        if (diff >= 0) gains += diff; else losses -= diff;
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    return 100 - (100 / (1 + (avgGain / avgLoss)));
}

async function startBacktest() {
    console.log("⏳ Conectando a Deriv API para Backtesting Gold Master...");
    ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

    ws.on('open', () => {
        // Pedimos H1 candles (últimos 500 = ~20 días)
        ws.send(JSON.stringify({ ticks_history: SYMBOL, end: 'latest', count: 500, style: 'candles', granularity: 3600, req_id: 1 }));
    });

    ws.on('message', (data) => {
        const msg = JSON.parse(data);

        if (msg.req_id === 1 && msg.candles) {
            console.log("✅ Historico H1 descargado.");
            candlesH1 = msg.candles;
            // Pedimos M1 candles (últimos 5000 = ~3.5 días = Miércoles, Jueves, Viernes)
            ws.send(JSON.stringify({ ticks_history: SYMBOL, end: 'latest', count: 5000, style: 'candles', granularity: 60, req_id: 2 }));
        }

        if (msg.req_id === 2 && msg.candles) {
            console.log("✅ Historico M1 descargado (Últimos 3.5 días). Iniciando simulación...");
            candlesM1 = msg.candles;
            runSimulation();
        }

        if (msg.error) {
            console.error("Error API:", msg.error.message);
            process.exit(1);
        }
    });
}

function runSimulation() {
    for (let i = 100; i < candlesM1.length; i++) {
        const currentCandle = candlesM1[i];
        const date = new Date(currentCandle.epoch * 1000);
        const hour = date.getUTCHours();
        const currentClose = currentCandle.close;
        const currentHigh = currentCandle.high;
        const currentLow = currentCandle.low;

        // Gestión del Trade Activo
        if (botState.activeTrade) {
            const entry = botState.activeTrade.entryPrice;
            const side = botState.activeTrade.side;

            const changeHigh = (currentHigh - entry) / entry * 120 * STAKE;
            const changeLow = (currentLow - entry) / entry * 120 * STAKE;

            let result = null;

            if (side === 'CALL') {
                if (changeHigh >= TP) result = TP;
                else if (changeLow <= -SL) result = -SL;
            } else {
                const changeP_High = (entry - currentLow) / entry * 120 * STAKE;
                const changeP_Low = (entry - currentHigh) / entry * 120 * STAKE;
                if (changeP_High >= TP) result = TP;
                else if (changeP_Low <= -SL) result = -SL;
            }

            if (result !== null) {
                botState.balance += result;
                if (result > 0) botState.wins++;
                else botState.losses++;
                botState.profit += result;
                tradeHistory.push({ date: date.toISOString(), side, pnl: result, balance: botState.balance });
                botState.activeTrade = null;
            }
            continue;
        }

        if (hour < 11 || hour > 21) continue;

        const sliceM1 = candlesM1.slice(i - 45, i + 1);
        const closesM1 = sliceM1.map(c => c.close);
        const s20 = calculateSMA(closesM1, SMA20_P);
        const s40 = calculateSMA(closesM1, SMA40_P);
        const rsi = calculateRSI(closesM1, RSI_P);

        const pastH1 = candlesH1.filter(c => c.epoch <= currentCandle.epoch);
        if (pastH1.length < 45) continue;
        const closesH1 = pastH1.map(c => c.close);
        const s20H1 = calculateSMA(closesH1, 20);
        const s40H1 = calculateSMA(closesH1, 40);

        const h1Trend = s20H1 > s40H1 ? 'UP' : (s20H1 < s40H1 ? 'DOWN' : 'NEUTRAL');

        // --- LÓGICA CALL ---
        if (h1Trend === 'UP' && s20 > s40) {
            if (currentLow <= s40 * 1.0002) {
                botState.setup = { active: true, side: 'CALL', resistance: currentHigh, support: null };
            }
            if (botState.setup.active && botState.setup.side === 'CALL' && currentClose > botState.setup.resistance && rsi < 70) {
                botState.activeTrade = { side: 'CALL', entryPrice: currentClose };
                botState.setup.active = false;
            } else if (botState.setup.active && botState.setup.side === 'CALL' && currentClose < s40) {
                botState.setup.active = false;
            }
        }
        // --- LÓGICA PUT ---
        else if (h1Trend === 'DOWN' && s20 < s40) {
            if (currentHigh >= s40 * 0.9998) {
                botState.setup = { active: true, side: 'PUT', support: currentLow, resistance: null };
            }
            if (botState.setup.active && botState.setup.side === 'PUT' && currentClose < botState.setup.support && rsi > 30) {
                botState.activeTrade = { side: 'PUT', entryPrice: currentClose };
                botState.setup.active = false;
            } else if (botState.setup.active && botState.setup.side === 'PUT' && currentClose > s40) {
                botState.setup.active = false;
            }
        }
    }

    console.log("=====================================================");
    console.log("📊 RESULTADOS BACKTESTING - GOLD MASTER PRO (Últimos 3.5 Días)");
    console.log("=====================================================");
    console.log(`Instrumento          : ${SYMBOL}`);
    console.log(`Estrategia           : Bidireccional H1 Trend + Pullback M1`);
    console.log(`Bloqueo Horario      : 11:00 UTC - 21:00 UTC (Londres/NY)`);
    console.log(`Stake por Op.        : $${STAKE}`);
    console.log(`Take Profit Fijo     : $${TP}`);
    console.log(`Stop Loss Fijo       : $${SL}`);
    console.log("-----------------------------------------------------");
    const totalOps = botState.wins + botState.losses;
    console.log(`Total Operaciones    : ${totalOps}`);
    console.log(`Operaciones Ganadas  : ${botState.wins} ✅`);
    console.log(`Operaciones Perdidas : ${botState.losses} ❌`);
    console.log(`Win Rate (Precisión) : ${totalOps > 0 ? ((botState.wins / totalOps) * 100).toFixed(2) : 0}%`);
    console.log(`Beneficio Neto (PnL) : $${botState.profit.toFixed(2)}`);
    console.log("-----------------------------------------------------");
    console.log(`Balance Inicial      : $${startingBalance}`);
    console.log(`Balance Final        : $${botState.balance.toFixed(2)}`);
    console.log("=====================================================");
    process.exit(0);
}

startBacktest();
