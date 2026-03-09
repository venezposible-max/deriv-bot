const WebSocket = require('ws');
const APP_ID = 1089;
const SYMBOL = 'stpRNG';

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
let allTicks = [];
const HOURS_BACK = 9;
const TOTAL_TICKS_NEEDED = 3600 * HOURS_BACK;

const CONFIG = {
    stake: 20,
    takeProfit: 2.00,
    stopLoss: 3.00,
    momentum: 3,
    distLimit: 0.12,
};

ws.on('open', () => {
    console.log(`\n📥 COMPARATIVA 9 HORAS: CONTINUACIÓN vs REVERSIÓN...`);
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
            console.log(`\n✅ DATA OK (${allTicks.length} ticks).`);
            runComparison();
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

function calculateSMA(prices, period) {
    if (prices.length < period) return null;
    return prices.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function getMACD(prices) {
    if (prices.length < 40) return null;
    const ema12 = calculateEMA(prices, 12);
    const ema26 = calculateEMA(prices, 26);
    if (!ema12 || !ema26) return null;
    const currentMacd = ema12 - ema26;
    const prevEma12 = calculateEMA(prices.slice(0, -1), 12);
    const prevEma26 = calculateEMA(prices.slice(0, -1), 26);
    const prevMacd = (prevEma12 && prevEma26) ? (prevEma12 - prevEma26) : null;
    return { current: currentMacd, prev: prevMacd };
}

function simulate(strategyType) {
    let balance = 0, wins = 0, losses = 0, trades = 0;
    let inTrade = false, entryPrice = 0, tradeType = null;
    const LATENCY = 10;

    // Solo procesamos las últimas 9 horas reales de la data recolectada
    const data = allTicks.slice(-TOTAL_TICKS_NEEDED);

    for (let i = 250; i < data.length - 1000; i++) {
        const quote = data[i];
        if (!inTrade) {
            const lastTicks = data.slice(i - CONFIG.momentum, i);
            const allUp = lastTicks.every((v, j) => j === 0 || v > lastTicks[j - 1]);
            const allDown = lastTicks.every((v, j) => j === 0 || v < lastTicks[j - 1]);
            const sma50 = calculateSMA(data.slice(0, i), 50);
            const sma200 = calculateSMA(data.slice(0, i), 200);
            const macd = getMACD(data.slice(0, i));

            let signalOk = false;

            if (strategyType === 'TREND') {
                let macdOk = macd && macd.prev !== null && (allUp ? macd.current > macd.prev : (allDown ? macd.current < macd.prev : false));
                if (sma50 && sma200 && macdOk && (Math.abs(quote - sma50) / sma50 * 100 < CONFIG.distLimit)) {
                    if (allUp && quote > sma200) { tradeType = 'UP'; signalOk = true; }
                    else if (allDown && quote < sma200) { tradeType = 'DOWN'; signalOk = true; }
                }
            } else { // REVERSAL
                if (allUp) { tradeType = 'DOWN'; signalOk = true; }
                else if (allDown) { tradeType = 'UP'; signalOk = true; }
            }

            if (signalOk) {
                inTrade = true;
                entryPrice = data[i + LATENCY];
                trades++;
                i += LATENCY;
            }
        } else {
            let diff = (quote - entryPrice);
            if (tradeType === 'DOWN') diff = -diff;
            const prof = diff * 7.5;
            if (prof >= CONFIG.takeProfit) { balance += CONFIG.takeProfit; wins++; inTrade = false; i += LATENCY; }
            else if (prof <= -CONFIG.stopLoss) { balance -= CONFIG.stopLoss; losses++; inTrade = false; i += LATENCY; }
        }
    }
    return { balance, wins, losses, trades };
}

function runComparison() {
    console.log("\n=========================================");
    console.log(`🕵️‍♂️ RESULTADOS 9 HORAS (TP $2 / SL $3)`);
    console.log("=========================================");

    const trend = simulate('TREND');
    const rev = simulate('REVERSAL');

    console.log(`📈 CONTINUACIÓN (Tendencia + MACD):`);
    console.log(`   PnL: $${trend.balance.toFixed(2)} | WR: ${((trend.wins / (trend.trades || 1)) * 100).toFixed(1)}% | Trades: ${trend.trades}`);

    console.log(`\n🔄 REVERSIÓN (Contra-Tendencia):`);
    console.log(`   PnL: $${rev.balance.toFixed(2)} | WR: ${((rev.wins / (rev.trades || 1)) * 100).toFixed(1)}% | Trades: ${rev.trades}`);
    console.log("=========================================\n");
}
