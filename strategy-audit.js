const WebSocket = require('ws');

const APP_ID = 1089;
const SYMBOL = 'frxXAUUSD';
const MULTIPLIER = 40;
const STAKE = 10;

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
let candles = [];

console.log(`\n🪐 EXPLORACIÓN DE ESTRATEGIAS ALTERNATIVAS (EL SANTO GRIAL)`);
console.log(`==========================================================`);

ws.on('open', () => { loadData(Math.floor(Date.now() / 1000), 4); });

function loadData(before, rem) {
    ws.send(JSON.stringify({ ticks_history: SYMBOL, end: before, count: 5000, granularity: 60, style: 'candles' }));
    ws.once('message', (d) => {
        const m = JSON.parse(d);
        candles = (m.candles || []).concat(candles);
        if (rem > 1 && m.candles.length > 0) loadData(m.candles[0].epoch - 1, rem - 1);
        else { runFinalAudit(); ws.close(); }
    });
}

function calculateRSI(prices, period = 14) {
    let rsi = new Array(prices.length).fill(null);
    let avgGain = 0, avgLoss = 0;
    for (let i = 1; i <= period; i++) {
        let d = prices[i] - prices[i - 1];
        if (d >= 0) avgGain += d; else avgLoss -= d;
    }
    avgGain /= period; avgLoss /= period;
    for (let i = period + 1; i < prices.length; i++) {
        let d = prices[i] - prices[i - 1];
        let g = d >= 0 ? d : 0, l = d < 0 ? -d : 0;
        avgGain = (avgGain * (period - 1) + g) / period;
        avgLoss = (avgLoss * (period - 1) + l) / period;
        rsi[i] = 100 - (100 / (1 + (avgGain / avgLoss)));
    }
    return rsi;
}

function runFinalAudit() {
    candles.sort((a, b) => a.epoch - b.epoch);
    const closes = candles.map(c => c.close);
    const rsi = calculateRSI(closes, 14);

    // ESTRATEGIA: RSI MEAN REVERSION (EXTREMA)
    // Buy < 25, Sell > 75
    let res = testRSI(rsi, 25, 75, 1.0, 1.0);

    console.log(`📋 RESULTADO RSI REVERSION (25/75):`);
    console.log(`PnL: $${res.pnl.toFixed(2)} | WR: ${res.wr.toFixed(1)}% | PF: ${res.pf.toFixed(2)}`);

    // ESTRATEGIA: GOLDEN CROSS BREAKOUT (VOLUMEN)
    // SMA 5 cruza 20
    const sma5 = calculateSMA(closes, 5);
    const sma20 = calculateSMA(closes, 20);
    let res2 = testCross(sma5, sma20, 1.2, 0.8);

    console.log(`\n📋 RESULTADO CROSSOVER MOMENTUM (5/20):`);
    console.log(`PnL: $${res2.pnl.toFixed(2)} | WR: ${res2.wr.toFixed(1)}% | PF: ${res2.pf.toFixed(2)}`);
}

function calculateSMA(p, n) {
    let s = new Array(p.length).fill(null);
    for (let i = n - 1; i < p.length; i++) {
        let sum = 0; for (let j = 0; j < n; j++) sum += p[i - j];
        s[i] = sum / n;
    }
    return s;
}

function testRSI(rsi, low, high, tp, sl) {
    let pnl = 0, wins = 0, losses = 0;
    for (let i = 20; i < candles.length - 20; i++) {
        let type = null;
        if (rsi[i] < low) type = 'CALL';
        else if (rsi[i] > high) type = 'PUT';
        if (type) {
            let r = sim(i, type, tp, sl);
            pnl += r; (r > 0) ? wins++ : losses++;
            i += 15;
        }
    }
    return { pnl, wr: (wins / (wins + losses) * 100) || 0, pf: (wins * tp) / (losses * sl) || 0 };
}

function testCross(sF, sS, tp, sl) {
    let pnl = 0, wins = 0, losses = 0;
    for (let i = 20; i < candles.length - 20; i++) {
        let type = null;
        if (sF[i - 1] <= sS[i - 1] && sF[i] > sS[i]) type = 'CALL';
        else if (sF[i - 1] >= sS[i - 1] && sF[i] < sS[i]) type = 'PUT';
        if (type) {
            let r = sim(i, type, tp, sl);
            pnl += r; (r > 0) ? wins++ : losses++;
            i += 10;
        }
    }
    return { pnl, wr: (wins / (wins + losses) * 100) || 0, pf: (wins * tp) / (losses * sl) || 0 };
}

function sim(idx, type, tp, sl) {
    let e = candles[idx + 1]?.open || candles[idx].close;
    for (let j = idx + 1; j < idx + 20 && j < candles.length; j++) {
        let p, l;
        if (type === 'CALL') {
            p = ((candles[j].high - e) / e) * MULTIPLIER * STAKE;
            l = ((candles[j].low - e) / e) * MULTIPLIER * STAKE;
        } else {
            p = ((e - candles[j].low) / e) * MULTIPLIER * STAKE;
            l = ((e - candles[j].high) / e) * MULTIPLIER * STAKE;
        }
        if (p >= tp) return tp;
        if (l <= -sl) return -sl;
    }
    return 0;
}
