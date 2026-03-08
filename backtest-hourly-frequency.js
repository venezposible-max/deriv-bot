const WebSocket = require('ws');
const APP_ID = 1089;
const SYMBOL = 'stpRNG';

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
let allTicks = [];
const TOTAL_TICKS_NEEDED = 86400;

const CONFIG = {
    stake: 20,
    takeProfit: 3.00,
    stopLoss: 3.00,
    multiplier: 750,
    smaPeriod: 50,
    smaLongPeriod: 200,
    rsiPeriod: 14,
    momentum: 5,
    distLimit: 0.08,
    trailStart: 0.50,
    trailDist: 0.30
};

ws.on('open', () => {
    console.log(`\n📥 ANALIZANDO FRECUENCIA DE TRADES POR HORA (24H)...`);
    fetchTicks();
});

function fetchTicks(beforeEpoch = 'latest') {
    ws.send(JSON.stringify({ ticks_history: SYMBOL, end: beforeEpoch || 'latest', count: 5000, style: 'ticks' }));
}

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.msg_type === 'history') {
        const chunk = msg.history.prices || [];
        const times = msg.history.times || [];
        allTicks = [...chunk, ...allTicks];
        if (allTicks.length < TOTAL_TICKS_NEEDED && chunk.length > 0) {
            fetchTicks(times[0]);
        } else {
            runHourlyAudit();
            ws.close();
        }
    }
});

function calculateSMA(prices, period) {
    if (prices.length < period) return null;
    let sum = 0;
    for (let i = prices.length - period; i < prices.length; i++) sum += prices[i];
    return sum / period;
}

function runHourlyAudit() {
    let hourlyStats = [];
    let currentHourTrades = 0;

    let inTrade = false, entryPrice = 0, tradeType = null, maxProfit = 0, lastSl = -99;

    // Aproximadamente 3600 ticks por hora
    const ticksPerHour = 3600;

    for (let i = 250; i < allTicks.length; i++) {
        const quote = allTicks[i];

        if (!inTrade) {
            const lastTicks = allTicks.slice(i - CONFIG.momentum, i);
            const allUp = lastTicks.every((v, idx, arr) => idx === 0 || v > arr[idx - 1]);
            const allDown = lastTicks.every((v, idx, arr) => idx === 0 || v < arr[idx - 1]);
            const sma50 = calculateSMA(allTicks.slice(0, i), CONFIG.smaPeriod);
            const sma200 = calculateSMA(allTicks.slice(0, i), CONFIG.smaLongPeriod);

            if (sma50 && sma200) {
                const distPct = Math.abs(quote - sma50) / sma50 * 100;
                if (distPct < CONFIG.distLimit) {
                    if (allUp && quote > sma200) { inTrade = true; tradeType = 'UP'; entryPrice = quote; maxProfit = 0; lastSl = -99; currentHourTrades++; }
                    else if (allDown && quote < sma200) { inTrade = true; tradeType = 'DOWN'; entryPrice = quote; maxProfit = 0; lastSl = -99; currentHourTrades++; }
                }
            }
        } else {
            let diff = (quote - entryPrice);
            if (tradeType === 'DOWN') diff = -diff;
            const prof = diff * 7.5;
            if (prof > maxProfit) maxProfit = prof;

            if (maxProfit >= CONFIG.trailStart) {
                const step = Math.floor(maxProfit / 0.50) * 0.50;
                const newFloor = step - CONFIG.trailDist;
                if (newFloor > lastSl) lastSl = newFloor;
            }

            let closed = false;
            if (prof >= CONFIG.takeProfit || prof <= -CONFIG.stopLoss || (lastSl > -90 && prof <= lastSl)) {
                closed = true;
            }

            if (closed) inTrade = false;
        }

        // Cada vez que completamos una hora (estimada)
        if (i > 0 && i % ticksPerHour === 0) {
            hourlyStats.push(currentHourTrades);
            currentHourTrades = 0;
        }
    }

    console.log("\n=========================================");
    console.log("🕵️‍♂️ REPORTE DE FRECUENCIA POR HORA (24H)");
    console.log("=========================================");
    console.log("H-1 (Más reciente) -> H-24 (Más antigua)");
    console.log("-----------------------------------------");
    hourlyStats.reverse().forEach((count, idx) => {
        const bar = "█".repeat(Math.min(count / 5, 20));
        console.log(`Hora -${idx + 1}: ${count} trades ${bar}`);
    });
    console.log("-----------------------------------------");
    console.log(`Promedio Real: ${(hourlyStats.reduce((a, b) => a + b, 0) / 24).toFixed(1)} trades/hora`);
    console.log("=========================================");
}
