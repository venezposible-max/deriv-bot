const WebSocket = require('ws');
const APP_ID = 1089;
const SYMBOL = 'stpRNG';

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
let allTicks = [];
const TOTAL_TICKS_NEEDED = 3600 * 7;

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
        else { runComparison(); ws.close(); }
    }
});

function calculateSMA(prices, period) {
    if (prices.length < period) return null;
    let sum = 0;
    for (let i = prices.length - period; i < prices.length; i++) sum += prices[i];
    return sum / period;
}

function runSim(mom, dist) {
    let balance = 0, wins = 0, losses = 0, trades = 0;
    let inTrade = false, entryPrice = 0, tradeType = null;
    const LATENCY = 10;

    for (let i = 250; i < allTicks.length; i++) {
        const quote = allTicks[i];
        if (!inTrade) {
            const lastTicks = allTicks.slice(i - mom, i);
            const allUp = lastTicks.every((v, j) => j === 0 || v > lastTicks[j - 1]);
            const allDown = lastTicks.every((v, j) => j === 0 || v < lastTicks[j - 1]);
            const sma50 = calculateSMA(allTicks.slice(0, i), 50);
            const sma200 = calculateSMA(allTicks.slice(0, i), 200);
            if (sma50 && sma200) {
                const distPct = Math.abs(quote - sma50) / sma50 * 100;
                if (distPct < dist) {
                    if (allUp && quote > sma200) { inTrade = true; tradeType = 'UP'; entryPrice = allTicks[i + LATENCY] || quote; trades++; i += LATENCY; }
                    else if (allDown && quote < sma200) { inTrade = true; tradeType = 'DOWN'; entryPrice = allTicks[i + LATENCY] || quote; trades++; i += LATENCY; }
                }
            }
        } else {
            let diff = (quote - entryPrice);
            if (tradeType === 'DOWN') diff = -diff;
            const prof = diff * 7.5;
            if (prof >= 3.00) { balance += 3.00; wins++; inTrade = false; i += LATENCY; }
            else if (prof <= -3.00) { balance -= 3.00; losses++; inTrade = false; i += LATENCY; }
        }
    }
    return { balance, wr: (wins / (trades || 1) * 100).toFixed(1) };
}

function runComparison() {
    console.log("\n--- COMPARATIVA ÚLTIMAS 7 HORAS ---");
    console.log(`TUYA (M5 / P 0.06): $${runSim(5, 0.06).balance.toFixed(2)} (WR: ${runSim(5, 0.06).wr}%)`);
    console.log(`TEST (M3 / P 0.15): $${runSim(3, 0.15).balance.toFixed(2)} (WR: ${runSim(3, 0.15).wr}%)`);
    console.log(`TEST (M7 / P 0.04): $${runSim(7, 0.04).balance.toFixed(2)} (WR: ${runSim(7, 0.04).wr}%)`);
}
