const WebSocket = require('ws');
const APP_ID = 1089;
const SYMBOL = 'R_100';

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
let allTicks = [];
const TOTAL_TICKS_NEEDED = 31000;

ws.on('open', () => {
    console.log(`📥 Probando RSI 35-65 con distLimit 0.08...`);
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
            console.log(`\n✅ DATA OK. Ejecutando comparativa...`);
            testRsi(25, 75);
            testRsi(35, 65);
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

function testRsi(low, high) {
    let balance = 0, wins = 0, losses = 0, inTrade = false, entryPrice = 0, tradeType = null, maxProfit = 0, lastSl = -100;

    for (let i = 250; i < allTicks.length; i++) {
        if (!inTrade) {
            const lastTicks = allTicks.slice(i - 5, i);
            const allUp = lastTicks.every((v, j) => j === 0 || v > lastTicks[j - 1]);
            const allDown = lastTicks.every((v, j) => j === 0 || v < lastTicks[j - 1]);
            const sma50 = calculateSMA(allTicks.slice(0, i), 50);
            const sma200 = calculateSMA(allTicks.slice(0, i), 200);
            const rsi = calculateRSI(allTicks.slice(0, i), 14);
            const price1m = allTicks[i - 60] || allTicks[0];
            const trend1m = allTicks[i] > price1m ? 'UP' : 'DOWN';
            const last5 = allTicks.slice(i - 5, i);
            let volSum = 0;
            for (let j = 1; j < last5.length; j++) volSum += Math.abs(last5[j] - last5[j - 1]);
            const volOK = (volSum / 5) > 0.015;

            if (sma50 && sma200 && rsi && volOK) {
                const distPct = Math.abs(allTicks[i] - sma50) / sma50 * 100;
                if (distPct < 0.08 && rsi > low && rsi < high) {
                    if ((allUp && allTicks[i] > sma200 && trend1m === 'UP') ||
                        (allDown && allTicks[i] < sma200 && trend1m === 'DOWN')) {
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
            let prof = diff * 40 * 20;
            if (prof > maxProfit) maxProfit = prof;
            if (maxProfit >= 0.50) {
                const step = Math.floor(maxProfit / 0.50) * 0.50;
                if (step - 0.55 > lastSl) lastSl = step - 0.55;
            }
            let closed = false, pnl = 0;
            if (prof <= -1.45) { pnl = -1.80; closed = true; }
            else if (prof >= 3.00) { pnl = 3.00; closed = true; }
            else if (lastSl > -99 && prof <= lastSl) { pnl = lastSl; closed = true; }
            if (closed) {
                balance += pnl;
                if (pnl > 0) wins++; else losses++;
                inTrade = false;
            }
        }
    }
    console.log(`RSI ${low}-${high}: PnL $${balance.toFixed(2)} | Trades: ${wins + losses} | WinRate: ${((wins / (wins + losses)) * 100).toFixed(1)}%`);
}
