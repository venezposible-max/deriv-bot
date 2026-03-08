const WebSocket = require('ws');
const APP_ID = 1089;
const SYMBOL = 'stpRNG';

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
let allTicks = [];
const TOTAL_TICKS_NEEDED = 86400; // ~24 Horas

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
    console.log(`\n📥 CONTANDO TRADES DE "CENTAVOS" (+0.17 - +0.20) EN 24 HORAS...`);
    fetchTicks();
});

function fetchTicks(beforeEpoch = 'latest') {
    ws.send(JSON.stringify({
        ticks_history: SYMBOL,
        end: beforeEpoch || 'latest',
        count: 5000,
        style: 'ticks'
    }));
}

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.msg_type === 'history') {
        const chunk = msg.history.prices || [];
        const times = msg.history.times || [];
        allTicks = [...chunk, ...allTicks];
        if (allTicks.length < TOTAL_TICKS_NEEDED && chunk.length > 0) {
            process.stdout.write('.');
            fetchTicks(times[0]);
        } else {
            runAudit();
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

function runAudit() {
    let tradesScalping = 0; // Trades de +0.15 a +0.25 (los centrallos)
    let tradesGrandes = 0; // Trades de +0.50 a +2.99
    let tradesTP = 0; // Trades de +3.00 (Take Profit completo)
    let tradesPerdidos = 0; // Rojos

    let inTrade = false, entryPrice = 0, tradeType = null, maxProfit = 0, lastSl = -99;

    for (let i = 250; i < allTicks.length; i++) {
        if (!inTrade) {
            const lastTicks = allTicks.slice(i - CONFIG.momentum, i);
            const allUp = lastTicks.every((v, idx, arr) => idx === 0 || v > arr[idx - 1]);
            const allDown = lastTicks.every((v, idx, arr) => idx === 0 || v < arr[idx - 1]);
            const sma50 = calculateSMA(allTicks.slice(0, i), CONFIG.smaPeriod);
            const sma200 = calculateSMA(allTicks.slice(0, i), CONFIG.smaLongPeriod);

            if (sma50 && sma200) {
                const distPct = Math.abs(allTicks[i] - sma50) / sma50 * 100;
                if (distPct < CONFIG.distLimit) {
                    if (allUp && allTicks[i] > sma200) { inTrade = true; tradeType = 'UP'; entryPrice = allTicks[i]; maxProfit = 0; lastSl = -99; }
                    else if (allDown && allTicks[i] < sma200) { inTrade = true; tradeType = 'DOWN'; entryPrice = allTicks[i]; maxProfit = 0; lastSl = -99; }
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

            let closed = false, pnl = 0;
            if (prof >= CONFIG.takeProfit) { pnl = CONFIG.takeProfit; closed = true; }
            else if (prof <= -CONFIG.stopLoss) { pnl = -CONFIG.stopLoss; closed = true; }
            else if (lastSl > -90 && prof <= lastSl) { pnl = lastSl; closed = true; }

            if (closed) {
                if (pnl >= 3.00) tradesTP++;
                else if (pnl > 0.40) tradesGrandes++;
                else if (pnl > 0 && pnl <= 0.25) tradesScalping++;
                else if (pnl < 0) tradesPerdidos++;
                inTrade = false;
            }
        }
    }

    console.log("\n=========================================");
    console.log("🕵️‍♂️ AUDITORÍA DE TRADES: ÚLTIMAS 24 HORAS");
    console.log("=========================================");
    console.log(`💵 Trades de "CENTAVOS" (+0.17 - +0.20): ${tradesScalping} 📦`);
    console.log(`💰 Trades MEDIANOS (+0.50 - +2.90): ${tradesGrandes} 💵`);
    console.log(`🏆 Trades TAKE PROFIT (+3.00): ${tradesTP} 🥇`);
    console.log(`❌ Trades PERDIDOS (Rojos): ${tradesPerdidos} 🛑`);
    console.log(`-----------------------------------------`);
    console.log(`Ratio Scalping vs Grandes: ${((tradesScalping / (tradesScalping + tradesGrandes + tradesTP)) * 100).toFixed(0)}% del total.`);
    console.log("=========================================");
}
