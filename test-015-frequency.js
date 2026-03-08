const WebSocket = require('ws');
const APP_ID = 1089;
const SYMBOL = 'stpRNG';

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
let allTicks = [];
const TOTAL_TICKS_NEEDED = 3600 * 24;

const CONFIG = {
    stake: 20,
    takeProfit: 3.00,
    stopLoss: 3.00,
    multiplier: 750,
    smaPeriod: 50,
    smaLongPeriod: 200,
    momentum: 3,       // El que el usuario puso
    distLimit: 0.15,   // El que el usuario pregunta
    trailStart: 0.50,
    trailDist: 0.30
};

ws.on('open', () => {
    console.log(`\n📥 SIMULANDO CONFIGURACIÓN 0.15 / MOM 3 (ULTIMAS 24H)...`);
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
            runStats();
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

function runStats() {
    let trades = 0;
    let inTrade = false, entryPrice = 0, tradeType = null, maxProfit = 0, lastSl = -99;

    for (let i = 250; i < allTicks.length; i++) {
        if (!inTrade) {
            const lastTicks = allTicks.slice(i - CONFIG.momentum, i);
            const allUp = lastTicks.every((v, j) => j === 0 || v > lastTicks[j - 1]);
            const allDown = lastTicks.every((v, j) => j === 0 || v < lastTicks[j - 1]);
            const sma50 = calculateSMA(allTicks.slice(0, i), CONFIG.smaPeriod);
            const sma200 = calculateSMA(allTicks.slice(0, i), CONFIG.smaLongPeriod);

            if (sma50 && sma200) {
                const distPct = Math.abs(allTicks[i] - sma50) / sma50 * 100;
                if (distPct < CONFIG.distLimit) {
                    if (allUp && allTicks[i] > sma200) { inTrade = true; tradeType = 'UP'; entryPrice = allTicks[i]; maxProfit = 0; lastSl = -99; trades++; }
                    else if (allDown && allTicks[i] < sma200) { inTrade = true; tradeType = 'DOWN'; entryPrice = allTicks[i]; maxProfit = 0; lastSl = -99; trades++; }
                }
            }
        } else {
            let diff = (allTicks[i] - entryPrice);
            if (tradeType === 'DOWN') diff = -diff;
            const prof = diff * 7.5;
            if (prof > maxProfit) maxProfit = prof;
            if (maxProfit >= CONFIG.trailStart) {
                const step = Math.floor(maxProfit / 0.50) * 0.50;
                const newFloor = step - CONFIG.trailDist;
                if (newFloor > lastSl) lastSl = newFloor;
            }
            let closed = false;
            if (prof >= CONFIG.takeProfit || prof <= -CONFIG.stopLoss || (lastSl > -90 && prof <= lastSl)) closed = true;
            if (closed) inTrade = false;
        }
    }

    console.log("\n=========================================");
    console.log(`📊 RESULTADO SIMULACIÓN (0.15 / MOM 3)`);
    console.log("=========================================");
    console.log(`Total Trades Simulados (24h): ${trades}`);
    console.log(`Promedio por Hora (Simulado): ${(trades / 24).toFixed(1)}`);
    console.log("=========================================");
}
