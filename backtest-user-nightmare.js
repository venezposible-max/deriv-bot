const WebSocket = require('ws');
const APP_ID = 1089;
const SYMBOL = 'R_100';

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
let allTicks = [];
const TOTAL_TICKS_NEEDED = 31000; // ~8.5 Horas

const CONFIG = {
    stake: 20,
    takeProfit: 3.00,
    stopLoss: 1.80,      // Estimado con slippage real
    multiplier: 40,
    smaPeriod: 50,
    smaLongPeriod: 200,
    rsiPeriod: 14,
    rsiLow: 25,
    rsiHigh: 75,
    momentum: 3,
    distLimit: 0.12,
    trailStart: 0.50,
    trailDist: 0.55
};

ws.on('open', () => {
    console.log(`📥 Analizando las últimas 8.5 horas solicitadas por el usuario...`);
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
        allTicks = [...(msg.history.prices || []), ...allTicks];
        if (allTicks.length < TOTAL_TICKS_NEEDED) {
            process.stdout.write('.');
            fetchTicks(msg.history.times[0]);
        } else {
            console.log(`\n✅ DATA OK: ${allTicks.length} ticks. Analizando...`);
            runSim();
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

function runSim() {
    let balance = 0, wins = 0, losses = 0, trades = 0;
    let fullLosses = 0, trailLosses = 0, trailWins = 0, tpWins = 0;
    let inTrade = false, entryPrice = 0, tradeType = null, maxProfit = 0, lastSl = -100;

    for (let i = 250; i < allTicks.length; i++) {
        if (!inTrade) {
            const lastTicks = allTicks.slice(i - CONFIG.momentum, i);
            const allUp = lastTicks.every((v, j) => j === 0 || v > lastTicks[j - 1]);
            const allDown = lastTicks.every((v, j) => j === 0 || v < lastTicks[j - 1]);
            const sma50 = calculateSMA(allTicks.slice(0, i), CONFIG.smaPeriod);
            const sma200 = calculateSMA(allTicks.slice(0, i), CONFIG.smaLongPeriod);
            const rsi = calculateRSI(allTicks.slice(0, i), 14);
            const price1m = allTicks[i - 60] || allTicks[0];
            const trend1m = allTicks[i] > price1m ? 'UP' : 'DOWN';
            const last5 = allTicks.slice(i - 5, i);
            let volSum = 0;
            for (let j = 1; j < last5.length; j++) volSum += Math.abs(last5[j] - last5[j - 1]);
            const volOK = (volSum / 5) > 0.015;

            if (sma50 && sma200 && rsi && volOK) {
                const distPct = Math.abs(allTicks[i] - sma50) / sma50 * 100;
                if (distPct < CONFIG.distLimit && rsi > 25 && rsi < 75) {
                    if ((allUp && allTicks[i] > sma200 && trend1m === 'UP') ||
                        (allDown && allTicks[i] < sma200 && trend1m === 'DOWN')) {
                        trades++;
                        inTrade = true;
                        tradeType = allUp ? 'UP' : 'DOWN';
                        entryPrice = allTicks[i];
                        maxProfit = 0;
                        lastSl = -1.50;
                    }
                }
            }
        } else {
            let diff = (allTicks[i] - entryPrice) / entryPrice;
            if (tradeType === 'DOWN') diff = -diff;
            let prof = diff * CONFIG.multiplier * CONFIG.stake;
            if (prof > maxProfit) maxProfit = prof;

            // Trailing
            if (maxProfit >= 0.50) {
                const step = Math.floor(maxProfit / 0.50) * 0.50;
                if (step - 0.55 > lastSl) lastSl = step - 0.55;
            }

            let closed = false, pnl = 0;
            if (prof <= -1.45) { pnl = -CONFIG.stopLoss; closed = true; fullLosses++; }
            else if (prof >= CONFIG.takeProfit) { pnl = CONFIG.takeProfit; closed = true; tpWins++; }
            else if (lastSl > -99 && prof <= lastSl) {
                pnl = lastSl;
                closed = true;
                if (pnl > 0) trailWins++; else trailLosses++;
            }

            if (closed) {
                balance += pnl;
                if (pnl > 0) wins++; else losses++;
                inTrade = false;
            }
        }
    }
    console.log(`\n=========================================`);
    console.log(`📊 REPORTE 8.5 HORAS (Sniper Elite)`);
    console.log(`=========================================`);
    console.log(`PnL Neto: $${balance.toFixed(2)}`);
    console.log(`Total Trades: ${trades}`);
    console.log(`Ganadas: ${wins} ✅ | Perdidas: ${losses} ❌`);
    console.log(`-----------------------------------------`);
    console.log(`Detalle de Ganadas:`);
    console.log(`- Por Meta ($3.00): ${tpWins}`);
    console.log(`- Por Trailing (>0): ${trailWins}`);
    console.log(`-----------------------------------------`);
    console.log(`Detalle de Perdidas:`);
    console.log(`- Por Stop Loss Full (-$1.80): ${fullLosses}`);
    console.log(`- Por Trailing (<0): ${trailLosses}`);
    console.log(`=========================================`);
}
