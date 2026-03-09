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
    momentum: 3,       // Momentum 3 Ticks
    distLimit: 0.15,   // Precisión 0.15
    useTrailing: false // SIN TRAILING STOP
};

ws.on('open', () => {
    console.log(`\n📥 INICIANDO BACKTEST MAESTRO (24H): SNIPER PRO + MACD FILTER...`);
    console.log(`⚙️ Config: M3 | P:0.15 | SL:3 | TP:3 | NO TRAILING | +MACD 12/26/9`);
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
            runSimulation();
            ws.close();
        }
    }
});

// --- INDICADORES TÉCNICOS ---
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

// MACD Avanzado (Línea + Señal)
function getMACDData(prices) {
    if (prices.length < 60) return null;

    // Para simplificar el backtest rápido, calculamos EMA12 y EMA26
    const ema12 = calculateEMA(prices, 12);
    const ema26 = calculateEMA(prices, 26);
    if (!ema12 || !ema26) return null;

    const macdLine = ema12 - ema26;

    // Calculamos una serie de MACD para sacar la señal de 9
    const macdSeries = [];
    for (let j = 0; j < 15; j++) {
        const pSlice = prices.slice(0, prices.length - j);
        const e12 = calculateEMA(pSlice, 12);
        const e26 = calculateEMA(pSlice, 26);
        if (e12 && e26) macdSeries.unshift(e12 - e26);
    }

    const signalLine = calculateEMA(macdSeries, 9);
    return { macdLine, signalLine };
}

function runSimulation() {
    let balance = 0, wins = 0, losses = 0, trades = 0;
    let inTrade = false, entryPrice = 0, tradeType = null;
    const LATENCY = 10; // Latencia realista de Deriv

    for (let i = 250; i < allTicks.length - LATENCY; i++) {
        const quote = allTicks[i];

        if (!inTrade) {
            // 1. Momentum de Ticks
            const lastTicks = allTicks.slice(i - CONFIG.momentum, i);
            const allUp = lastTicks.every((v, j) => j === 0 || v > lastTicks[j - 1]);
            const allDown = lastTicks.every((v, j) => j === 0 || v < lastTicks[j - 1]);

            // 2. Medias Móviles (Tendencia y Distancia)
            const sma50 = calculateSMA(allTicks.slice(0, i), CONFIG.smaPeriod);
            const sma200 = calculateSMA(allTicks.slice(0, i), CONFIG.smaLongPeriod);

            if (sma50 && sma200) {
                const distPct = Math.abs(quote - sma50) / sma50 * 100;

                // 3. Filtro MACD
                const macd = getMACDData(allTicks.slice(0, i));
                let macdOk = false;
                if (macd) {
                    if (allUp) macdOk = macd.macdLine > macd.signalLine;
                    if (allDown) macdOk = macd.macdLine < macd.signalLine;
                }

                if (distPct < CONFIG.distLimit && macdOk) {
                    if (allUp && quote > sma200) {
                        inTrade = true; tradeType = 'UP';
                        entryPrice = allTicks[i + LATENCY];
                        trades++;
                        i += LATENCY;
                    }
                    else if (allDown && quote < sma200) {
                        inTrade = true; tradeType = 'DOWN';
                        entryPrice = allTicks[i + LATENCY];
                        trades++;
                        i += LATENCY;
                    }
                }
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
    console.log("🕵️‍♂️ RESULTADO SNIPER PRO + MACD (24H)");
    console.log("=========================================");
    console.log(`PnL Neto: $${balance.toFixed(2)} USD 💰`);
    console.log(`Win Rate: ${((wins / (trades || 1)) * 100).toFixed(1)}% 🎯`);
    console.log(`Total Trades: ${trades} (${wins}W / ${losses}L)`);
    console.log(`Trades por Hora: ${(trades / 24).toFixed(1)}`);
    console.log("=========================================\n");
}
