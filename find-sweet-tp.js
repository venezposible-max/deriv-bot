const WebSocket = require('ws');
const APP_ID = 1089;
const SYMBOL = 'stpRNG';

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
let allTicks = [];
const TOTAL_TICKS_NEEDED = 3600 * 5; // 5 Horas

ws.on('open', () => fetchTicks());

function fetchTicks(beforeEpoch = 'latest') {
    ws.send(JSON.stringify({ ticks_history: SYMBOL, end: beforeEpoch || 'latest', count: 5000, style: 'ticks' }));
}

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.msg_type === 'history') {
        const chunk = msg.history.prices || [];
        const times = msg.history.times || [];
        allTicks = [...chunk, ...allTicks];
        if (allTicks.length < TOTAL_TICKS_NEEDED && chunk.length > 0) fetchTicks(times[0]);
        else { runTPAnalysis(); ws.close(); }
    }
});

function calculateSMA(prices, period) {
    if (prices.length < period) return null;
    let sum = 0;
    for (let i = prices.length - period; i < prices.length; i++) sum += prices[i];
    return sum / period;
}

function simulate(tpValue) {
    let balance = 0, wins = 0, losses = 0, trades = 0;
    let inTrade = false, entryPrice = 0, tradeType = null;
    const LATENCY = 10;

    for (let i = 250; i < allTicks.length; i++) {
        const quote = allTicks[i];
        if (!inTrade) {
            const lastTicks = allTicks.slice(i - 3, i); // M3
            const allUp = lastTicks.every((v, j) => j === 0 || v > lastTicks[j - 1]);
            const allDown = lastTicks.every((v, j) => j === 0 || v < lastTicks[j - 1]);
            const sma50 = calculateSMA(allTicks.slice(0, i), 50);
            const sma200 = calculateSMA(allTicks.slice(0, i), 200);
            if (sma50 && sma200) {
                const distPct = Math.abs(quote - sma50) / sma50 * 100;
                if (distPct < 0.08) {
                    if (allUp && quote > sma200) { inTrade = true; tradeType = 'UP'; entryPrice = allTicks[i + LATENCY] || quote; trades++; i += LATENCY; }
                    else if (allDown && quote < sma200) { inTrade = true; tradeType = 'DOWN'; entryPrice = allTicks[i + LATENCY] || quote; trades++; i += LATENCY; }
                }
            }
        } else {
            let diff = (quote - entryPrice);
            if (tradeType === 'DOWN') diff = -diff;
            const prof = diff * 7.5;
            if (prof >= tpValue) { balance += tpValue; wins++; inTrade = false; i += LATENCY; }
            else if (prof <= -3.00) { balance -= 3.00; losses++; inTrade = false; i += LATENCY; }
        }
    }
    return { balance, wr: (wins / (trades || 1) * 100).toFixed(1) };
}

function runTPAnalysis() {
    console.log("\n--- ANÁLISIS DE 'PUNTO DULCE' (SWEET SPOT) TP ---");
    console.log("Objetivo: Encontrar el TP que no se devuelve.");
    const results = [1.00, 1.50, 2.00, 2.50, 3.00, 4.00].map(tp => ({ tp, ...simulate(tp) }));
    results.forEach(r => {
        console.log(`TP: $${r.tp.toFixed(2)} | Balance 5h: $${r.balance.toFixed(2)} | WR: ${r.wr}%`);
    });
}
