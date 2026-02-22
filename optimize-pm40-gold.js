const WebSocket = require('ws');

const APP_ID = 1089;
const SYMBOL = 'frxXAUUSD';
const TIMEFRAME = 60; // M1

const endTS = Math.floor(Date.now() / 1000);
const startTS = endTS - (15 * 24 * 60 * 60); // 15 días de optimización profunda

const STAKE = 10;
const MULTIPLIER = 40;

const TP_OPTIONS = [0.8, 1.0, 1.2, 1.5, 2.0];
const SL_OPTIONS = [0.8, 1.0, 1.2, 1.5, 2.0];

let allCandles = [];

console.log(`\n🔍 OPTIMIZADOR PRO: PM-40 OK (ORO - 15 DÍAS)`);
console.log(`==========================================================`);
console.log(`Probando ${TP_OPTIONS.length * SL_OPTIONS.length} combinaciones...`);
console.log(`==========================================================\n`);

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

ws.on('open', () => {
    ws.send(JSON.stringify({
        ticks_history: SYMBOL,
        end: 'latest',
        start: startTS,
        count: 5000,
        granularity: TIMEFRAME,
        style: 'candles'
    }));
});

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.msg_type === 'candles') {
        const candles = msg.candles || [];
        if (candles.length > 40) {
            runOptimization(candles);
        }
        ws.close();
    }
});

function calculateSMA(data, period) {
    let smas = new Array(data.length).fill(null);
    for (let i = period - 1; i < data.length; i++) {
        let sum = 0;
        for (let j = 0; j < period; j++) sum += data[i - j].close;
        smas[i] = sum / period;
    }
    return smas;
}

function runOptimization(candles) {
    const sma20 = calculateSMA(candles, 20);
    const sma40 = calculateSMA(candles, 40);
    let results = [];

    for (const tp of TP_OPTIONS) {
        for (const sl of SL_OPTIONS) {
            let balance = 0, wins = 0, losses = 0, total = 0;
            let setup = false, resistance = 0;

            for (let i = 40; i < candles.length - 1; i++) {
                const c = candles[i];
                if (sma20[i] > sma40[i]) {
                    if (c.low <= sma40[i] * 1.0002) {
                        setup = true;
                        resistance = c.high;
                        continue;
                    }
                    if (setup && c.close > resistance) {
                        total++;
                        const entry = candles[i + 1].open;
                        let outcome = 0;
                        for (let j = i + 1; j < candles.length; j++) {
                            const p = ((candles[j].high - entry) / entry) * MULTIPLIER * STAKE;
                            const l = ((candles[j].low - entry) / entry) * MULTIPLIER * STAKE;
                            if (p >= tp) { outcome = tp; break; }
                            if (l <= -sl) { outcome = -sl; break; }
                        }
                        balance += outcome;
                        if (outcome > 0) wins++; else if (outcome < 0) losses++;
                        setup = false;
                        i += 20;
                    } else if (setup) {
                        if (c.high < resistance) resistance = c.high;
                        if (c.close < sma40[i] * 0.998) setup = false;
                    }
                } else setup = false;
            }
            results.push({ tp, sl, balance, wr: (wins / total) * 100, total });
        }
    }

    results.sort((a, b) => b.balance - a.balance);

    console.log(`🏆 TOP 5 CONFIGURACIONES PARA EL ORO (PM-40):`);
    console.log(`--------------------------------------------------`);
    results.slice(0, 5).forEach((r, i) => {
        console.log(`${i + 1}. TP: $${r.tp.toFixed(1)} | SL: $${r.sl.toFixed(1)} | PnL: $${r.balance.toFixed(2)} | WR: ${r.wr.toFixed(1)}% | Ops: ${r.total}`);
    });
    console.log(`--------------------------------------------------\n`);
}

function simulate(candles, start, tp, sl) {
    const entry = candles[start].open;
    for (let j = start; j < candles.length; j++) {
        const p = ((candles[j].high - entry) / entry) * MULTIPLIER * STAKE;
        const lo = ((candles[j].low - entry) / entry) * MULTIPLIER * STAKE;
        if (p >= tp) return tp;
        if (lo <= -sl) return -sl;
    }
    return 0;
}
