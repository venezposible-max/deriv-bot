const WebSocket = require('ws');
const APP_ID = 1089;
const SYMBOL = 'R_100';

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
let allTicks = [];
const TOTAL_TICKS_NEEDED = 84000; // ~24 Horas de data real

const CONFIG = {
    stake: 20,
    takeProfit: 3.00,
    stopLoss: 1.80,      // Realidad Slippage (-$1.71 a -$1.86)
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
    console.log(`📥 Descargando DATA TICKS para REPORTE 24H HORA POR HORA...`);
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
    const ticksPerHour = Math.floor(allTicks.length / 24);

    console.log(`\n====================================================`);
    console.log(`📊 DESGLOSE 24 HORAS (AMETRALLADORA + SLIPPAGE)`);
    console.log(`====================================================`);
    console.log(`HORA | TRADES | WINS | LOSS | PnL HORA | ACUMULADO`);
    console.log(`----------------------------------------------------`);

    for (let h = 0; h < 24; h++) {
        let hBalance = 0, hWins = 0, hLosses = 0, hTrades = 0;
        let inTrade = false, entryPrice = 0, tradeType = null, maxProfit = 0, lastSl = -100;

        const startIdx = h * ticksPerHour;
        const endIdx = (h + 1) * ticksPerHour;
        const hourTicks = allTicks.slice(startIdx, endIdx);

        for (let i = 250; i < hourTicks.length; i++) {
            const quote = hourTicks[i];
            if (!inTrade) {
                const lastT = hourTicks.slice(i - CONFIG.momentum, i);
                const up = lastT.every((v, j) => j === 0 || v > lastT[j - 1]);
                const down = lastT.every((v, j) => j === 0 || v < lastT[j - 1]);

                const s50 = calculateSMA(hourTicks.slice(0, i), CONFIG.smaPeriod);
                const s200 = calculateSMA(hourTicks.slice(0, i), CONFIG.smaLongPeriod);
                const rsi = calculateRSI(hourTicks.slice(0, i), 14);

                if (s50 && s200 && rsi) {
                    const dist = Math.abs(quote - s50) / s50 * 100;
                    if (dist < CONFIG.distLimit) {
                        if (up && quote > s200 && rsi > CONFIG.rsiLow) { inTrade = true; tradeType = 'UP'; hTrades++; }
                        else if (down && quote < s200 && rsi < CONFIG.rsiHigh) { inTrade = true; tradeType = 'DOWN'; hTrades++; }
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
                    hBalance += pnl;
                    if (pnl > 0) hWins++; else hLosses++;
                    inTrade = false;
                }
            }
        }
        globalBalance += hBalance;
        console.log(`H${(h + 1).toString().padStart(2)}  | ${hTrades.toString().padStart(6)} | ${hWins.toString().padStart(4)} | ${hLosses.toString().padStart(4)} | $${hBalance.toFixed(2).padStart(8)} | $${globalBalance.toFixed(2).padStart(8)}`);
    }
    console.log(`----------------------------------------------------`);
    console.log(`PNL FINAL 24 HORAS: $${globalBalance.toFixed(2)}`);
    console.log(`====================================================`);
}
