const WebSocket = require('ws');
const APP_ID = 1089;
const SYMBOL = 'stpRNG';

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
let allTicks = [];
const TOTAL_TICKS_NEEDED = 86400;

const BASE_CONFIG = {
    stake: 20,
    takeProfit: 3.00,
    stopLoss: 3.00,
    multiplier: 750,
    smaPeriod: 50,
    smaLongPeriod: 200,
    rsiPeriod: 14,
    momentum: 3,
    distLimit: 0.15
};

const TESTS = [
    { name: "ACTUAL ($0.50 start / $0.30 dist)", start: 0.50, dist: 0.30 },
    { name: "MEDIO ($1.00 start / $0.80 dist)", start: 1.00, dist: 0.80 },
    { name: "RELAJADO ($1.50 start / $1.00 dist)", start: 1.50, dist: 1.00 }
];

ws.on('open', () => {
    console.log(`\n📥 DESCARGANDO DATA 24H PARA ANALIZAR TRAILING STOP...`);
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
            console.log(`\n✅ DATA OK.`);
            runComparison();
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

function runSimulation(trailStart, trailDist) {
    let balance = 0, wins = 0, losses = 0, trades = 0;
    let inTrade = false, entryPrice = 0, tradeType = null, maxProfit = 0, lastSl = -99;

    for (let i = 250; i < allTicks.length; i++) {
        if (!inTrade) {
            const lastTicks = allTicks.slice(i - BASE_CONFIG.momentum, i);
            const allUp = lastTicks.every((v, j) => j === 0 || v > lastTicks[j - 1]);
            const allDown = lastTicks.every((v, j) => j === 0 || v < lastTicks[j - 1]);
            const sma50 = calculateSMA(allTicks.slice(0, i), BASE_CONFIG.smaPeriod);
            const sma200 = calculateSMA(allTicks.slice(0, i), BASE_CONFIG.smaLongPeriod);

            if (sma50 && sma200) {
                const distPct = Math.abs(allTicks[i] - sma50) / sma50 * 100;
                if (distPct < BASE_CONFIG.distLimit) {
                    if (allUp && allTicks[i] > sma200) { inTrade = true; tradeType = 'UP'; entryPrice = allTicks[i]; maxProfit = 0; lastSl = -99; trades++; }
                    else if (allDown && allTicks[i] < sma200) { inTrade = true; tradeType = 'DOWN'; entryPrice = allTicks[i]; maxProfit = 0; lastSl = -99; trades++; }
                }
            }
        } else {
            let diff = (allTicks[i] - entryPrice);
            if (tradeType === 'DOWN') diff = -diff;
            const prof = diff * 7.5;
            if (prof > maxProfit) maxProfit = prof;

            if (maxProfit >= trailStart) {
                const step = Math.floor(maxProfit / 0.50) * 0.50; // Mantenemos escalones de 0.50
                const newFloor = step - trailDist;
                if (newFloor > lastSl) lastSl = newFloor;
            }

            let closed = false, pnl = 0;
            if (prof >= BASE_CONFIG.takeProfit) { pnl = BASE_CONFIG.takeProfit; closed = true; }
            else if (prof <= -BASE_CONFIG.stopLoss) { pnl = -BASE_CONFIG.stopLoss; closed = true; }
            else if (lastSl > -90 && prof <= lastSl) { pnl = lastSl; closed = true; }

            if (closed) { balance += pnl; if (pnl > 0) wins++; else losses++; inTrade = false; }
        }
    }
    return { balance, wins, losses, trades };
}

function runComparison() {
    console.log("\n=========================================");
    console.log("🕵️‍♂️ COMPARATIVA DE TRAILING STOP (24H)");
    console.log("=========================================");
    TESTS.forEach(t => {
        const res = runSimulation(t.start, t.dist);
        console.log(`\n📊 ${t.name}:`);
        console.log(`   PnL: $${res.balance.toFixed(2)} | W: ${res.wins} | L: ${res.losses}`);
        console.log(`   Win Rate: ${((res.wins / (res.trades || 1)) * 100).toFixed(1)}%`);
    });
    console.log("=========================================\n");
}
