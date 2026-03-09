const WebSocket = require('ws');
const APP_ID = 1089;
const SYMBOL = 'stpRNG';

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
let allTicks = [];
const TOTAL_TICKS_NEEDED = 3600 * 7; // 7 HORAS EXACTAS

// CONFIGURACIÓN SOLICITADA POR USUARIO
const CONFIG = {
    stake: 20,
    takeProfit: 3.00,
    stopLoss: 3.00,
    multiplier: 750,
    smaPeriod: 50,
    smaLongPeriod: 200,
    momentum: 5,       // Momentum 5
    distLimit: 0.06,   // Precisión 0.06
    useTrailing: false // SIN TRAILING (Para cobrar $3 completos)
};

ws.on('open', () => {
    console.log(`\n📥 BACKTESTING REALISTA: ULTIMAS 7 HORAS...`);
    console.log(`⚙️ Config: M5 | P:0.06 | SL:3 | TP:3 | STK:20 | TRAIL:OFF`);
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
            runBacktest();
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

function runBacktest() {
    let balance = 0, wins = 0, losses = 0, trades = 0;
    let inTrade = false, entryPrice = 0, tradeType = null;

    // Latencia realista (10 ticks de demora para abrir/cerrar)
    const LATENCY = 10;

    for (let i = 250; i < allTicks.length; i++) {
        const quote = allTicks[i];
        if (!inTrade) {
            const lastTicks = allTicks.slice(i - CONFIG.momentum, i);
            const allUp = lastTicks.every((v, j) => j === 0 || v > lastTicks[j - 1]);
            const allDown = lastTicks.every((v, j) => j === 0 || v < lastTicks[j - 1]);
            const sma50 = calculateSMA(allTicks.slice(0, i), CONFIG.smaPeriod);
            const sma200 = calculateSMA(allTicks.slice(0, i), CONFIG.smaLongPeriod);

            if (sma50 && sma200) {
                const distPct = Math.abs(quote - sma50) / sma50 * 100;
                if (distPct < CONFIG.distLimit) {
                    if (allUp && quote > sma200) {
                        inTrade = true; tradeType = 'UP';
                        entryPrice = allTicks[i + LATENCY] || quote; // Simular latencia de entrada
                        trades++;
                        i += LATENCY;
                    }
                    else if (allDown && quote < sma200) {
                        inTrade = true; tradeType = 'DOWN';
                        entryPrice = allTicks[i + LATENCY] || quote;
                        trades++;
                        i += LATENCY;
                    }
                }
            }
        } else {
            let diff = (quote - entryPrice);
            if (tradeType === 'DOWN') diff = -diff;
            const prof = diff * 7.5;

            let closed = false, pnl = 0;
            if (prof >= CONFIG.takeProfit) { pnl = CONFIG.takeProfit; closed = true; }
            else if (prof <= -CONFIG.stopLoss) { pnl = -CONFIG.stopLoss; closed = true; }

            if (closed) {
                balance += pnl;
                if (pnl > 0) wins++; else losses++;
                inTrade = false;
                i += LATENCY; // Simular latencia de salida
            }
        }
    }

    console.log("\n=========================================");
    console.log("🕵️‍♂️ RESULTADO BACKTEST REALISTA (7H)");
    console.log("=========================================");
    console.log(`PnL Neto (7h): $${balance.toFixed(2)}`);
    console.log(`Balance Final Estimado: $${(204.32 + balance).toFixed(2)}`);
    console.log(`Win Rate: ${((wins / (trades || 1)) * 100).toFixed(1)}%`);
    console.log(`Trades Totales: ${trades} (${wins}W / ${losses}L)`);
    console.log(`Promedio por hora: ${(trades / 7).toFixed(1)} trades`);
    console.log("=========================================");
}
