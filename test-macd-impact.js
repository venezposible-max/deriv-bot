const WebSocket = require('ws');
const APP_ID = 1089;
const SYMBOL = 'stpRNG';

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
let allTicks = [];
const TOTAL_TICKS_NEEDED = 3600 * 24;

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
        else { runMACDAnalysis(); ws.close(); }
    }
});

function calculateEMA(prices, period) {
    if (prices.length < period) return null;
    let k = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < prices.length; i++) {
        ema = prices[i] * k + ema * (1 - k);
    }
    return ema;
}

function calculateSMA(prices, period) {
    if (prices.length < period) return null;
    return prices.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function getMACD(prices) {
    const ema12 = calculateEMA(prices, 12);
    const ema26 = calculateEMA(prices, 26);
    if (!ema12 || !ema26) return null;
    const macdLine = ema12 - ema26;
    // Simplificado: Necesitaríamos un array de MACDs para calcular la señal. 
    // Usaremos el MACD actual comparado con el anterior como "clon" de señal rápida.
    const prevEma12 = calculateEMA(prices.slice(0, -1), 12);
    const prevEma26 = calculateEMA(prices.slice(0, -1), 26);
    const prevMacdLine = prevEma12 - prevEma26;
    return { current: macdLine, previous: prevMacdLine };
}

function simulate(useMACD) {
    let balance = 0, wins = 0, losses = 0, trades = 0;
    let inTrade = false, entryPrice = 0, tradeType = null;
    const LATENCY = 10;

    for (let i = 250; i < allTicks.length; i++) {
        const quote = allTicks[i];
        if (!inTrade) {
            const lastTicks = allTicks.slice(i - 3, i);
            const allUp = lastTicks.every((v, j) => j === 0 || v > lastTicks[j - 1]);
            const allDown = lastTicks.every((v, j) => j === 0 || v < lastTicks[j - 1]);
            const sma50 = calculateSMA(allTicks.slice(0, i), 50);
            const sma200 = calculateSMA(allTicks.slice(0, i), 200);

            if (sma50 && sma200) {
                const distPct = Math.abs(quote - sma50) / sma50 * 100;
                if (distPct < 0.15) {
                    let macdSignals = true;
                    if (useMACD) {
                        const m = getMACD(allTicks.slice(0, i));
                        if (m) {
                            if (allUp) macdSignals = m.current > m.previous && m.current > 0;
                            if (allDown) macdSignals = m.current < m.previous && m.current < 0;
                        } else macdSignals = false;
                    }

                    if (macdSignals) {
                        if (allUp && quote > sma200) { inTrade = true; tradeType = 'UP'; entryPrice = allTicks[i + LATENCY] || quote; trades++; i += LATENCY; }
                        else if (allDown && quote < sma200) { inTrade = true; tradeType = 'DOWN'; entryPrice = allTicks[i + LATENCY] || quote; trades++; i += LATENCY; }
                    }
                }
            }
        } else {
            let diff = (quote - entryPrice);
            if (tradeType === 'DOWN') diff = -diff;
            const prof = diff * 7.5;
            if (prof >= 3.0) { balance += 3.0; wins++; inTrade = false; i += LATENCY; }
            else if (prof <= -3.0) { balance -= 3.0; losses++; inTrade = false; i += LATENCY; }
        }
    }
    return { balance, wr: (wins / (trades || 1) * 100).toFixed(1), trades };
}

function runMACDAnalysis() {
    console.log("\n--- EXPERIMENTO: IMPACTO DEL MACD (24H) ---");
    const normal = simulate(false);
    const macd = simulate(true);

    console.log(`🚀 SNIPER NORMAL (M3 / P 0.15):`);
    console.log(`   PnL: $${normal.balance.toFixed(2)} | WR: ${normal.wr}% | Trades: ${normal.trades}`);

    console.log(`\n🧠 SNIPER + MACD FILTER:`);
    console.log(`   PnL: $${macd.balance.toFixed(2)} | WR: ${macd.wr}% | Trades: ${macd.trades}`);
    console.log("=========================================\n");
}
