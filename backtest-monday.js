const WebSocket = require('ws');

const APP_ID = 1089;
const SYMBOL = 'frxXAUUSD';

const STAKE = 10;
const TP = 1.00;
const SL = 1.60;
const SMA20_P = 20;
const SMA40_P = 40;
const RSI_P = 14;

let botState = {
    balance: 1000,
    wins: 0,
    losses: 0,
    profit: 0,
    setup: { active: false, side: null, resistance: null, support: null },
    activeTrade: null
};

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
    let avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    return 100 - (100 / (1 + ((gains / period) / avgLoss)));
}

async function startBacktest() {
    console.log("⏳ Conectando a Deriv API para descargar Lunes 16 de Feb 2026...");
    const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
    let candlesM1 = [];
    let candlesH1 = [];

    // Fechas en UTC para el Lunes pasado
    const unixStartH1 = Math.floor(new Date("2026-02-10T00:00:00Z").getTime() / 1000);
    const unixEndH1 = Math.floor(new Date("2026-02-16T23:59:59Z").getTime() / 1000);

    const unixStartM1 = Math.floor(new Date("2026-02-15T22:00:00Z").getTime() / 1000);
    const unixEndM1 = Math.floor(new Date("2026-02-16T23:59:59Z").getTime() / 1000);

    ws.on('open', () => {
        ws.send(JSON.stringify({ ticks_history: SYMBOL, start: unixStartH1, end: unixEndH1, count: 500, style: 'candles', granularity: 3600, req_id: 1 }));
    });

    ws.on('message', (data) => {
        const msg = JSON.parse(data);
        if (msg.req_id === 1 && msg.candles) {
            candlesH1 = msg.candles;
            ws.send(JSON.stringify({ ticks_history: SYMBOL, start: unixStartM1, end: unixEndM1, count: 2000, style: 'candles', granularity: 60, req_id: 2 }));
        }

        if (msg.req_id === 2 && msg.candles) {
            candlesM1 = msg.candles;
            ws.terminate();
            runSimulation(candlesM1, candlesH1);
        }

        if (msg.error) {
            console.error("Error API:", msg.error.message);
            process.exit(1);
        }
    });
}

function runSimulation(candlesM1, candlesH1) {
    const mondayStart = new Date("2026-02-16T00:00:00Z").getTime();
    const mondayEnd = new Date("2026-02-16T23:59:59Z").getTime();

    for (let i = 45; i < candlesM1.length; i++) {
        const currentCandle = candlesM1[i];
        const epochMs = currentCandle.epoch * 1000;

        const isMonday = epochMs >= mondayStart && epochMs <= mondayEnd;
        const date = new Date(epochMs);
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
                if (result > 0) botState.wins++; else botState.losses++;
                botState.profit += result;
                botState.activeTrade = null;
            }
            continue;
        }

        if (!isMonday || hour < 11 || hour > 21) continue;

        const sliceM1 = candlesM1.slice(i - 45, i + 1);
        const closesM1 = sliceM1.map(c => c.close);
        const s20 = calculateSMA(closesM1, SMA20_P);
        const s40 = calculateSMA(closesM1, SMA40_P);
        const rsi = calculateRSI(closesM1, RSI_P);

        const pastH1 = candlesH1.filter(c => c.epoch <= currentCandle.epoch);
        if (pastH1.length < 40) continue;
        const closesH1 = pastH1.map(c => c.close);
        const s20H1 = calculateSMA(closesH1, 20);
        const s40H1 = calculateSMA(closesH1, 40);

        const h1Trend = s20H1 > s40H1 ? 'UP' : (s20H1 < s40H1 ? 'DOWN' : 'NEUTRAL');

        if (h1Trend === 'UP' && s20 > s40) {
            if (currentLow <= s40 * 1.0002) botState.setup = { active: true, side: 'CALL', resistance: currentHigh };
            if (botState.setup.active && botState.setup.side === 'CALL' && currentClose > botState.setup.resistance && rsi < 70) {
                botState.activeTrade = { side: 'CALL', entryPrice: currentClose };
                botState.setup.active = false;
            } else if (botState.setup.active && botState.setup.side === 'CALL' && currentClose < s40) {
                botState.setup.active = false;
            }
        }
        else if (h1Trend === 'DOWN' && s20 < s40) {
            if (currentHigh >= s40 * 0.9998) botState.setup = { active: true, side: 'PUT', support: currentLow };
            if (botState.setup.active && botState.setup.side === 'PUT' && currentClose < botState.setup.support && rsi > 30) {
                botState.activeTrade = { side: 'PUT', entryPrice: currentClose };
                botState.setup.active = false;
            } else if (botState.setup.active && botState.setup.side === 'PUT' && currentClose > s40) {
                botState.setup.active = false;
            }
        }
    }

    console.log("=====================================================");
    console.log("📊 RESULTADOS BACKTESTING - GOLD MASTER PRO");
    console.log("📅 LUNES: 16 de Febrero de 2026");
    console.log("=====================================================");
    console.log(`Operaciones Totales : ${botState.wins + botState.losses}`);
    console.log(`Ganadas ✅           : ${botState.wins}`);
    console.log(`Perdidas ❌          : ${botState.losses}`);
    console.log(`Win Rate             : ${botState.wins + botState.losses > 0 ? ((botState.wins / (botState.wins + botState.losses)) * 100).toFixed(2) : 0}%`);
    console.log(`Beneficio Neto (PnL) : $${botState.profit.toFixed(2)}`);
    console.log("=====================================================");
}
startBacktest();
