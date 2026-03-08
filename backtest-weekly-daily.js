const WebSocket = require('ws');
const APP_ID = 1089;
const SYMBOL = 'R_100';

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
let allTicks = [];
const TICKS_PER_DAY = 84000;
const TOTAL_TICKS_NEEDED = TICKS_PER_DAY * 7;

const CONFIG = {
    stake: 20,
    takeProfit: 3.00,
    stopLoss: 1.80,      // Realidad Slippage
    multiplier: 40,
    smaPeriod: 50,
    smaLongPeriod: 200,
    rsiPeriod: 14,
    rsiLow: 20,
    rsiHigh: 80,
    momentum: 3,
    distLimit: 0.15,
    trailStart: 0.50,
    trailDist: 0.55
};

ws.on('open', () => {
    console.log(`📥 Descargando DATA TICKS de los ÚLTIMOS 7 DÍAS para REPORTE DIARIO...`);
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
            console.log(`\n✅ DATA CARGADA: ${allTicks.length} ticks.`);
            runSimulation();
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

function calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) return 50;
    let gains = 0, losses = 0;
    for (let i = prices.length - period; i < prices.length; i++) {
        let diff = prices[i] - prices[i - 1];
        if (diff >= 0) gains += diff; else losses -= diff;
    }
    let rs = (gains / period) / ((losses / period) || 1);
    return 100 - (100 / (1 + rs));
}

function runSimulation() {
    let globalBalance = 0;

    console.log(`\n====================================================`);
    console.log(`📊 REPORTE SEMANAL: DÍA POR DÍA (ÚLTIMOS 7 DÍAS)`);
    console.log(`====================================================`);
    console.log(`DÍA     | TRADES | WINS | LOSS | PnL DÍA  | ACUMULADO`);
    console.log(`----------------------------------------------------`);

    const days = ["DOM", "LUN", "MAR", "MIE", "JUE", "VIE", "HOY"];

    for (let d = 0; d < 7; d++) {
        let dBalance = 0, dWins = 0, dLosses = 0, dTrades = 0;
        let inTrade = false, entryPrice = 0, tradeType = null, maxProfit = 0, lastSl = -100;

        const startIdx = d * TICKS_PER_DAY;
        const endIdx = (d + 1) * TICKS_PER_DAY;
        const dayTicks = allTicks.slice(startIdx, endIdx);

        for (let i = 250; i < dayTicks.length; i++) {
            const quote = dayTicks[i];
            if (!inTrade) {
                const lastT = dayTicks.slice(i - CONFIG.momentum, i);
                const up = lastT.every((v, j) => j === 0 || v > lastT[j - 1]);
                const down = lastT.every((v, j) => j === 0 || v < lastT[j - 1]);

                const s50 = calculateSMA(dayTicks.slice(0, i), CONFIG.smaPeriod);
                const s200 = calculateSMA(dayTicks.slice(0, i), CONFIG.smaLongPeriod);
                const rsi = calculateRSI(dayTicks.slice(0, i), 14);

                if (s50 && s200 && rsi) {
                    const dist = Math.abs(quote - s50) / s50 * 100;
                    if (dist < CONFIG.distLimit) {
                        if (up && quote > s200 && rsi > CONFIG.rsiLow) { inTrade = true; tradeType = 'UP'; dTrades++; }
                        else if (down && quote < s200 && rsi < CONFIG.rsiHigh) { inTrade = true; tradeType = 'DOWN'; dTrades++; }
                        if (inTrade) { entryPrice = quote; maxProfit = 0; lastSl = -100; }
                    }
                }
            } else {
                let diff = (quote - entryPrice) / entryPrice;
                if (tradeType === 'DOWN') diff = -diff;
                let prof = diff * CONFIG.multiplier * CONFIG.stake;
                if (prof > maxProfit) maxProfit = prof;

                if (maxProfit >= CONFIG.trailStart) {
                    const step = Math.floor(maxProfit / 0.50) * 0.50;
                    if (step - CONFIG.trailDist > lastSl) lastSl = step - CONFIG.trailDist;
                }

                let closed = false;
                let pnl = 0;
                if (prof <= -1.45) { pnl = -CONFIG.stopLoss; closed = true; }
                else if (prof >= CONFIG.takeProfit) { pnl = CONFIG.takeProfit; closed = true; }
                else if (lastSl > -99 && prof <= lastSl) { pnl = lastSl; closed = true; }

                if (closed) {
                    dBalance += pnl;
                    if (pnl > 0) dWins++; else dLosses++;
                    inTrade = false;
                }
            }
        }
        globalBalance += dBalance;
        console.log(`DÍA ${d + 1} (${days[d]}) | ${dTrades.toString().padStart(6)} | ${dWins.toString().padStart(4)} | ${dLosses.toString().padStart(4)} | $${dBalance.toFixed(2).padStart(8)} | $${globalBalance.toFixed(2).padStart(8)}`);
    }
    console.log(`----------------------------------------------------`);
    console.log(`PNL TOTAL SEMANAL: $${globalBalance.toFixed(2)}`);
    console.log(`====================================================`);
}
