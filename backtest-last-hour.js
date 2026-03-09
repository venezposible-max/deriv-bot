const WebSocket = require('ws');
const APP_ID = 1089;
const SYMBOL = 'stpRNG';

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
let allTicks = [];
const TOTAL_TICKS_NEEDED = 3600; // 1 hora aprox

const CONFIG = {
    stake: 20,
    takeProfit: 2.00,
    stopLoss: 3.00,
    multiplier: 750,
    smaPeriod: 50,
    smaLongPeriod: 200,
    momentum: 3,
    distLimit: 0.08,
    useTrailing: false
};

ws.on('open', () => {
    console.log(`\n📥 BACKTEST ULTRA-RÁPIDO: ÚLTIMA 1 HORA...`);
    console.log(`⚙️ Config: TP $2.0 | SL $3.0 | M3 | +MACD FILTER...`);
    fetchTicks();
});

function fetchTicks() {
    ws.send(JSON.stringify({
        ticks_history: SYMBOL,
        end: 'latest',
        count: 5000,
        style: 'ticks'
    }));
}

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.msg_type === 'history') {
        const chunk = msg.history.prices || [];
        allTicks = chunk; // En 1 hora sobran con 5000 ticks
        console.log(`✅ DATA cargada (${allTicks.length} ticks).`);
        runSimulation();
        ws.close();
    }
});

function calculateEMA(prices, period) {
    if (prices.length < period) return null;
    let k = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < prices.length; i++) {
        ema = (prices[i] * k) + (ema * (1 - k));
    }
    return ema;
}

function calculateSMA(prices, period) {
    if (prices.length < period) return null;
    return prices.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function getMACDData(prices) {
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

function runSimulation() {
    let balance = 0, wins = 0, losses = 0, trades = 0;
    let inTrade = false, entryPrice = 0, tradeType = null;
    const LATENCY = 10;

    // Empezamos desde el final para tener la "última hora" real
    const ticksToProcess = allTicks.slice(-3600); // ~1 hora de ticks

    for (let i = 250; i < ticksToProcess.length - LATENCY; i++) {
        const quote = ticksToProcess[i];
        if (!inTrade) {
            const lastTicks = ticksToProcess.slice(i - CONFIG.momentum, i);
            const allUp = lastTicks.every((v, j) => j === 0 || v > lastTicks[j - 1]);
            const allDown = lastTicks.every((v, j) => j === 0 || v < lastTicks[j - 1]);
            const sma50 = calculateSMA(ticksToProcess.slice(0, i), CONFIG.smaPeriod);
            const sma200 = calculateSMA(ticksToProcess.slice(0, i), CONFIG.smaLongPeriod);
            const macd = getMACDData(ticksToProcess.slice(0, i));

            let macdOk = false;
            if (macd && macd.prev !== null) {
                if (allUp) macdOk = macd.current > macd.prev;
                if (allDown) macdOk = macd.current < macd.prev;
            }

            if (sma50 && sma200 && macdOk && (Math.abs(quote - sma50) / sma50 * 100 < CONFIG.distLimit)) {
                if (allUp && quote > sma200) { inTrade = true; tradeType = 'UP'; entryPrice = ticksToProcess[i + LATENCY]; trades++; i += LATENCY; }
                else if (allDown && quote < sma200) { inTrade = true; tradeType = 'DOWN'; entryPrice = ticksToProcess[i + LATENCY]; trades++; i += LATENCY; }
            }
        } else {
            let diff = (quote - entryPrice);
            if (tradeType === 'DOWN') diff = -diff;
            const prof = diff * 7.5;
            if (prof >= CONFIG.takeProfit) { balance += CONFIG.takeProfit; wins++; inTrade = false; i += LATENCY; }
            else if (prof <= -CONFIG.stopLoss) { balance -= CONFIG.stopLoss; losses++; inTrade = false; i += LATENCY; }
        }
    }

    console.log("\n=========================================");
    console.log("🕵️‍♂️ RESULTADO ÚLTIMA 1 HORA (CON MACD)");
    console.log("=========================================");
    console.log(`PnL Neto: $${balance.toFixed(2)} USD 💰`);
    console.log(`Win Rate: ${((wins / (trades || 1)) * 100).toFixed(1)}% 🎯`);
    console.log(`Ganadas: ${wins} | Perdidas: ${losses}`);
    console.log(`Total Trades: ${trades}`);
    console.log("=========================================\n");
}
