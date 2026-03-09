const WebSocket = require('ws');
const APP_ID = 1089;
const SYMBOL = 'stpRNG';

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
let allTicks = [];
const TOTAL_TICKS_NEEDED = 3600 * 24;

const CONFIG = {
    stake: 20,
    takeProfit: 2.00,
    stopLoss: 20.00,   // SL ASIGNADO A $20
    multiplier: 750,
    smaPeriod: 50,
    smaLongPeriod: 200,
    momentum: 3,
    distLimit: 0.15,
    useTrailing: false
};

ws.on('open', () => {
    console.log(`\n📥 BACKTEST 24H (ÚLTIMAS): TP $2.00 | SL $20.00 | M3 | MACD...`);
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
            console.log(`\n✅ DATA OK (${allTicks.length} ticks).`);
            runSim();
            ws.close();
        }
    }
});

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
    const emaPrev12 = calculateEMA(prices.slice(0, -1), 12);
    const emaPrev26 = calculateEMA(prices.slice(0, -1), 26);
    const prevMacd = emaPrev12 - emaPrev26;
    return { current: macdLine, prev: prevMacd };
}

function runSim() {
    let bal = 0, wins = 0, losses = 0, trades = 0;
    const latency = 10;

    for (let i = 250; i < allTicks.length - 1000; i++) {
        const lastTicks = allTicks.slice(i - CONFIG.momentum, i);
        const allUp = lastTicks.every((v, j) => j === 0 || v > lastTicks[j - 1]);
        const allDown = lastTicks.every((v, j) => j === 0 || v < lastTicks[j - 1]);
        const sma50 = calculateSMA(allTicks.slice(0, i), 50);
        const sma200 = calculateSMA(allTicks.slice(0, i), 200);
        const macd = getMACD(allTicks.slice(0, i));

        let macdOk = false;
        if (macd) {
            if (allUp) macdOk = macd.current > macd.prev;
            if (allDown) macdOk = macd.current < macd.prev;
        }

        if (sma50 && sma200 && macdOk && (Math.abs(allTicks[i] - sma50) / sma50 * 100 < CONFIG.distLimit)) {
            let type = allUp ? 'UP' : (allDown ? 'DOWN' : null);
            if (type && ((type === 'UP' && allTicks[i] > sma200) || (type === 'DOWN' && allTicks[i] < sma200))) {
                trades++;
                let ex = null;
                let entry = allTicks[i + latency];
                for (let k = i + latency + 1; k < i + 1000; k++) {
                    let p = (allTicks[k] - entry) * 7.5;
                    if (type === 'DOWN') p = -p;
                    if (p >= CONFIG.takeProfit) { ex = CONFIG.takeProfit; break; }
                    if (p <= -CONFIG.stopLoss) { ex = -CONFIG.stopLoss; break; }
                }
                if (ex) { bal += ex; if (ex > 0) wins++; else losses++; }
            }
        }
    }
    console.log(`\n=========================================`);
    console.log(`🕵️‍♂️ RESULTADO ÚLTIMAS 24H (SL $20.0)`);
    console.log(`=========================================`);
    console.log(`PnL Neto ($): ${bal.toFixed(2)}`);
    console.log(`Win Rate: ${((wins / (trades || 1)) * 100).toFixed(1)}%`);
    console.log(`Ganadas: ${wins} | Perdidas: ${losses}`);
    console.log(`Total Trades Realistas: ${trades}`);
    console.log(`=========================================\n`);
}
