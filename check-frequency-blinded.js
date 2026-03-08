const WebSocket = require('ws');
const APP_ID = 1089;
const SYMBOL = 'R_100';

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
let allTicks = [];
const TOTAL_TICKS_NEEDED = 20000; // ~5-6 Horas

const CONFIG = {
    stake: 20,
    takeProfit: 3.00,
    stopLoss: 1.80,
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
    console.log(`📥 Verificando FRECUENCIA con BLINDAJE RSI (6H)...`);
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
            runStats();
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

function runStats() {
    let trades = 0;
    let inTrade = false;
    let entryIdx = 0;

    for (let i = 250; i < allTicks.length; i++) {
        if (!inTrade) {
            const lastTicks = allTicks.slice(i - CONFIG.momentum, i);
            const allUp = lastTicks.every((v, j) => j === 0 || v > lastTicks[j - 1]);
            const allDown = lastTicks.every((v, j) => j === 0 || v < lastTicks[j - 1]);
            const sma50 = calculateSMA(allTicks.slice(0, i), CONFIG.smaPeriod);
            const sma200 = calculateSMA(allTicks.slice(0, i), CONFIG.smaLongPeriod);
            const rsi = calculateRSI(allTicks.slice(0, i), 14);
            const price1m = allTicks[i - 60];
            const trend1m = allTicks[i] > price1m ? 'UP' : 'DOWN';
            const last5 = allTicks.slice(i - 5, i);
            let volSum = 0;
            for (let j = 1; j < last5.length; j++) volSum += Math.abs(last5[j] - last5[j - 1]);
            const volOK = (volSum / 5) > 0.015;

            if (sma50 && sma200 && rsi && volOK) {
                const distPct = Math.abs(allTicks[i] - sma50) / sma50 * 100;
                if (distPct < CONFIG.distLimit) {
                    if ((allUp && allTicks[i] > sma200 && rsi > 25 && rsi < 75 && trend1m === 'UP') ||
                        (allDown && allTicks[i] < sma200 && rsi > 25 && rsi < 75 && trend1m === 'DOWN')) {
                        trades++;
                        inTrade = true;
                        entryIdx = i;
                    }
                }
            }
        } else {
            if (i - entryIdx > 30) inTrade = false; // Simulación de trade de 30 seg
        }
    }
    console.log(`\n=========================================`);
    console.log(`📊 ESTADÍSTICA DE FRECUENCIA (Blindado)`);
    console.log(`=========================================`);
    console.log(`Total Trades Estimados (6H): ${trades}`);
    console.log(`Frecuencia Real: 1 trade cada ${(21600 / trades).toFixed(0)} seg.`);
    console.log(`Relación min: ${(trades / (21600 / 60)).toFixed(2)} trades/min.`);
    console.log(`=========================================`);
}
