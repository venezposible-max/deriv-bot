const WebSocket = require('ws');
const APP_ID = 1089;
const SYMBOL = 'R_100';

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
const TICKS_PER_WEEK = 588000;
const START_WEEK = 6;
const END_WEEK = 12;

const CONFIG = {
    stake: 20,
    takeProfit: 3.00,
    stopLoss: 1.80,
    multiplier: 40,
    smaPeriod: 50,
    smaLongPeriod: 200,
    rsiPeriod: 14,
    rsiLow: 20,
    rsiHigh: 80,
    momentum: 3,
    distLimit: 0.15,
    trailStart: 0.50,
    trailDist: 0.55
};

let currentWeek = START_WEEK;
// Retroceder 5 semanas de epoch
let lastEpoch = Math.floor(Date.now() / 1000) - (5 * 7 * 24 * 3600);
let totalPnLGlobal = 2242.50; // Empezamos con lo acumulado de las primeras 5 semanas

console.log(`\n====================================================`);
console.log(`📊 CONTINUANDO MEGA-BACKTEST: SEMANAS 6 A 12`);
console.log(`====================================================`);
console.log(`SEM | TRADES | WINS | LOSS | PnL SEMANA | ACUMULADO`);
console.log(`----------------------------------------------------`);

ws.on('open', () => {
    fetchNextWeek();
});

function fetchNextWeek() {
    if (currentWeek > END_WEEK) {
        console.log(`----------------------------------------------------`);
        console.log(`TOTAL NETO 3 MESES (ESTIMADO): $${totalPnLGlobal.toFixed(2)} 💰`);
        console.log(`PROMEDIO MENSUAL: $${(totalPnLGlobal / 3).toFixed(2)} 🔥`);
        console.log(`====================================================`);
        ws.close();
        return;
    }

    let weeklyTicks = [];

    function fetchTicks(beforeEpoch) {
        ws.send(JSON.stringify({
            ticks_history: SYMBOL,
            end: beforeEpoch,
            count: 5000,
            style: 'ticks'
        }));
    }

    const messageHandler = (data) => {
        const msg = JSON.parse(data);
        if (msg.msg_type === 'history') {
            const chunk = msg.history.prices || [];
            const times = msg.history.times || [];
            weeklyTicks = [...chunk, ...weeklyTicks];

            if (weeklyTicks.length < TICKS_PER_WEEK && chunk.length > 0) {
                fetchTicks(times[0]);
            } else {
                ws.removeListener('message', messageHandler);
                lastEpoch = times[0];
                const res = runSimulation(weeklyTicks);
                totalPnLGlobal += res.balance;
                console.log(`${currentWeek.toString().padStart(3)} | ${res.trades.toString().padStart(6)} | ${res.wins.toString().padStart(4)} | ${res.losses.toString().padStart(4)} | $${res.balance.toFixed(2).padStart(9)} | $${totalPnLGlobal.toFixed(2).padStart(9)}`);
                currentWeek++;
                weeklyTicks = [];
                fetchNextWeek();
            }
        }
    };

    ws.on('message', messageHandler);
    fetchTicks(lastEpoch);
}

function calculateSMA(prices, period) {
    if (prices.length < period) return null;
    let sum = 0;
    for (let i = prices.length - period; i < prices.length; i++) sum += prices[i];
    return sum / period;
}

function calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) return 50;
    let gains = 0, losses = 0;
    for (let i = prices.length - period; i < prices.length; i++) {
        let diff = prices[i] - prices[i - 1];
        if (diff >= 0) gains += diff; else losses -= diff;
    }
    let rs = (gains / period) / ((losses / period) || 1);
    return 100 - (100 / (1 + rs));
}

function runSimulation(ticks) {
    let balance = 0, wins = 0, losses = 0, trades = 0;
    let inTrade = false, entryPrice = 0, tradeType = null, maxProfit = 0, lastSl = -100;

    for (let i = 250; i < ticks.length; i++) {
        const quote = ticks[i];
        if (!inTrade) {
            const lastT = ticks.slice(i - CONFIG.momentum, i);
            const up = lastT.length === CONFIG.momentum && lastT.every((v, j) => j === 0 || v > lastT[j - 1]);
            const down = lastT.length === CONFIG.momentum && lastT.every((v, j) => j === 0 || v < lastT[j - 1]);

            const s50 = calculateSMA(ticks.slice(0, i), CONFIG.smaPeriod);
            const s200 = calculateSMA(ticks.slice(0, i), CONFIG.smaLongPeriod);
            const rsi = calculateRSI(ticks.slice(0, i), 14);

            if (s50 && s200 && rsi) {
                const dist = Math.abs(quote - s50) / s50 * 100;
                if (dist < CONFIG.distLimit) {
                    if (up && quote > s200 && rsi > CONFIG.rsiLow) { inTrade = true; tradeType = 'UP'; trades++; }
                    else if (down && quote < s200 && rsi < CONFIG.rsiHigh) { inTrade = true; tradeType = 'DOWN'; trades++; }
                    if (inTrade) { entryPrice = quote; maxProfit = 0; lastSl = -100; }
                }
            }
        } else {
            let diff = (quote - entryPrice) / entryPrice;
            if (tradeType === 'DOWN') diff = -diff;
            let prof = diff * CONFIG.multiplier * CONFIG.stake;
            if (prof > maxProfit) maxProfit = prof;

            if (maxProfit >= CONFIG.trailStart) {
                const step = Math.floor(maxProfit / 0.50) * 0.50;
                if (step - CONFIG.trailDist > lastSl) lastSl = step - CONFIG.trailDist;
            }

            let closed = false;
            let pnl = 0;
            if (prof <= -1.45) { pnl = -CONFIG.stopLoss; closed = true; }
            else if (prof >= CONFIG.takeProfit) { pnl = CONFIG.takeProfit; closed = true; }
            else if (lastSl > -99 && prof <= lastSl) { pnl = lastSl; closed = true; }

            if (closed) {
                balance += pnl;
                if (pnl > 0) wins++; else losses++;
                inTrade = false;
            }
        }
    }
    return { balance, wins, losses, trades };
}
