const WebSocket = require('ws');

const APP_ID = 1089;
const SYMBOL = 'R_100';
const days = 7;
const hours = days * 24;
const endTime = Math.floor(Date.now() / 1000);
const startTime = endTime - (hours * 60 * 60);

let allTicks = [];
let nextEnd = endTime;

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

ws.on('open', () => fetchBatch());

function fetchBatch() {
    ws.send(JSON.stringify({
        ticks_history: SYMBOL,
        end: nextEnd,
        start: startTime,
        count: 5000,
        style: 'ticks'
    }));
}

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.msg_type === 'history') {
        const prices = msg.history.prices;
        const times = msg.history.times;
        if (prices.length > 0) {
            allTicks = prices.concat(allTicks);
            nextEnd = times[0] - 1;
            if (nextEnd > startTime && allTicks.length < 500000) fetchBatch();
            else { runFullOptimizer(allTicks); ws.close(); }
        } else { runFullOptimizer(allTicks); ws.close(); }
    }
});

function runFullOptimizer(ticks) {
    console.log(`\n🕵️ OPTIMIZADOR SEMANAL - BUSCANDO EL "SANTO GRIAL" DE V100`);
    console.log(`==========================================================`);

    const settings = [
        { m: 5, tp: 0.5, sl: 0.5 },
        { m: 7, tp: 0.6, sl: 0.6 },
        { m: 10, tp: 1.0, sl: 1.0 },
        { m: 12, tp: 2.0, sl: 2.0 },
        { m: 5, tp: 0.5, sl: 1.0 },
        { m: 7, tp: 1.0, sl: 2.0 }
    ];

    settings.forEach(s => {
        simulate(ticks, s.m, s.tp, s.sl, "CONTRA-TENDENCIA");
        simulate(ticks, s.m, s.tp, s.sl, "A-FAVOR-TENDENCIA");
    });
}

function simulate(ticks, m, tp, sl, strategy) {
    let balance = 0, wins = 0, total = 0, inTrade = false, entry = 0, type = null;
    const mult = 40, stake = 10;

    for (let i = m; i < ticks.length; i++) {
        if (!inTrade) {
            const last = ticks.slice(i - m, i);
            const allDown = last.every((v, idx) => idx === 0 || v < last[idx - 1]);
            const allUp = last.every((v, idx) => idx === 0 || v > last[idx - 1]);

            if (strategy === "CONTRA-TENDENCIA") {
                if (allDown) { inTrade = true; type = 'UP'; entry = ticks[i]; }
                else if (allUp) { inTrade = true; type = 'DOWN'; entry = ticks[i]; }
            } else {
                if (allUp) { inTrade = true; type = 'UP'; entry = ticks[i]; }
                else if (allDown) { inTrade = true; type = 'DOWN'; entry = ticks[i]; }
            }
        } else {
            let diff = (ticks[i] - entry) / entry;
            if (type === 'DOWN') diff = -diff;
            const p = diff * mult * stake;
            if (p >= tp) { wins++; total++; balance += tp; inTrade = false; i += 30; }
            else if (p <= -sl) { total++; balance -= sl; inTrade = false; i += 30; }
        }
    }

    if (balance > 0) {
        console.log(`⭐ GANADORA: ${strategy} | M:${m} | TP:${tp} | SL:${sl}`);
        console.log(`   PnL: $${balance.toFixed(2)} | WR: ${((wins / total) * 100).toFixed(1)}% | Trades: ${total}\n`);
    }
}
