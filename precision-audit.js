const WebSocket = require('ws');
const APP_ID = 1089;
const SYMBOL = 'stpRNG';

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
let allTicks = [];
const TOTAL_TICKS_NEEDED = 3600 * 12; // 12h para rapidez

ws.on('open', () => {
    console.log(`\n📥 ANALIZANDO MÉTODOS DE PRECISIÓN (ULTIMAS 12H)...`);
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
            process.stdout.write('.');
            fetchTicks(times[0]);
        } else {
            console.log(`\n✅ DATA OK.`);
            runPrecisionAnalysis();
            ws.close();
        }
    }
});

// EMA for MACD
function calculateEMA(prices, period) {
    if (prices.length < period) return null;
    let k = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < prices.length; i++) ema = (prices[i] * k) + (ema * (1 - k));
    return ema;
}

function calculateSMA(p, n) { if (p.length < n) return null; return p.slice(-n).reduce((a, b) => a + b, 0) / n; }

function getMACD(prices) {
    if (prices.length < 60) return null;
    const ema12 = calculateEMA(prices, 12);
    const ema26 = calculateEMA(prices, 26);
    if (!ema12 || !ema26) return null;
    const macdLine = ema12 - ema26;
    const prevEma12 = calculateEMA(prices.slice(0, -1), 12);
    const prevEma26 = calculateEMA(prices.slice(0, -1), 26);
    const prevMacd = prevEma12 - prevEma26;
    return { current: macdLine, prev: prevMacd };
}

function simulateStrategy(filterType) {
    let bal = 0, wins = 0, losses = 0, trades = 0;
    const TP = 2.0, SL = 3.0, mom = 3, latency = 10;

    for (let i = 250; i < allTicks.length - 1000; i++) {
        const lastTicks = allTicks.slice(i - mom, i);
        const allUp = lastTicks.every((v, j) => j === 0 || v > lastTicks[j - 1]);
        const allDown = lastTicks.every((v, j) => j === 0 || v < lastTicks[j - 1]);

        let passFilter = false;
        if (allUp || allDown) {
            const sma50 = calculateSMA(allTicks.slice(0, i), 50);
            const sma200 = calculateSMA(allTicks.slice(0, i), 200);
            const dist = Math.abs(allTicks[i] - sma50) / sma50 * 100;

            if (dist < 0.12) {
                if (filterType === 'NORMAL') {
                    if (allUp && allTicks[i] > sma200) passFilter = true;
                    if (allDown && allTicks[i] < sma200) passFilter = true;
                } else if (filterType === 'MACD') {
                    const macd = getMACD(allTicks.slice(0, i));
                    if (macd) {
                        if (allUp && allTicks[i] > sma200 && macd.current > macd.prev) passFilter = true;
                        if (allDown && allTicks[i] < sma200 && macd.current < macd.prev) passFilter = true;
                    }
                } else if (filterType === 'SUPER_ELITE') {
                    const macd = getMACD(allTicks.slice(0, i));
                    // SMA Cross local
                    const sma5 = calculateSMA(allTicks.slice(0, i), 5);
                    const sma20 = calculateSMA(allTicks.slice(0, i), 20);
                    if (macd && sma5 && sma20) {
                        if (allUp && allTicks[i] > sma200 && macd.current > macd.prev && sma5 > sma20) passFilter = true;
                        if (allDown && allTicks[i] < sma200 && macd.current < macd.prev && sma5 < sma20) passFilter = true;
                    }
                }
            }
        }

        if (passFilter) {
            trades++;
            let type = allUp ? 'UP' : 'DOWN';
            let entry = allTicks[i + latency];
            let res = null;
            for (let k = i + latency + 1; k < i + 1000; k++) {
                let p = (allTicks[k] - entry) * 7.5;
                if (type === 'DOWN') p = -p;
                if (p >= TP) { res = TP; break; }
                if (p <= -SL) { res = -SL; break; }
            }
            if (res) { bal += res; if (res > 0) wins++; else losses++; }
        }
    }
    return { bal, wr: (wins / (trades || 1) * 100).toFixed(1), trades };
}

function runPrecisionAnalysis() {
    console.log("\n=========================================");
    console.log("🕵️‍♂️ ANALISIS DE PRECISIÓN (SWEET SPOT)");
    console.log("=========================================");

    const normal = simulateStrategy('NORMAL');
    const macd = simulateStrategy('MACD');
    const elite = simulateStrategy('SUPER_ELITE');

    console.log(`🛡️ NORMAL (Tendencia + Dist):`);
    console.log(`   PnL: $${normal.bal.toFixed(2)} | WR: ${normal.wr}% | Trades: ${normal.trades}`);

    console.log(`\n🧠 MACD (Fuerza de Impulso):`);
    console.log(`   PnL: $${macd.bal.toFixed(2)} | WR: ${macd.wr}% | Trades: ${macd.trades}`);

    console.log(`\n👑 SUPER ELITE (Trend + MACD + SMA Cross):`);
    console.log(`   PnL: $${elite.bal.toFixed(2)} | WR: ${elite.wr}% | Trades: ${elite.trades}`);
    console.log("=========================================\n");
}
