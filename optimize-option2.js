const WebSocket = require('ws');

const APP_ID = 1089;
const SYMBOL = 'R_100';
const hours = 24;
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
            if (nextEnd > startTime && allTicks.length < 50000) {
                fetchBatch();
            } else {
                runDeepAnalysis(allTicks);
                ws.close();
            }
        } else {
            runDeepAnalysis(allTicks);
            ws.close();
        }
    }
});

function runDeepAnalysis(ticks) {
    console.log(`\n📊 OPTIMIZACIÓN DE LA "OPCIÓN 2" (Últimas 24h)`);
    console.log(`==========================================================`);

    test("OPCIÓN 2 ORIGINAL (TP 1.0, SL 1.5, M8)", ticks, 1.00, 1.50, 8);
    test("OPCIÓN 2 AJUSTADA (TP 0.8, SL 1.2, M10)", ticks, 0.80, 1.20, 10);
    test("OPCIÓN 2 SEGURA (TP 0.5, SL 0.5, M12)", ticks, 0.50, 0.50, 12);
    test("HÍBRIDO GANADOR (TP 0.6, SL 0.6, M7)", ticks, 0.60, 0.60, 7);
}

function test(name, ticks, tp, sl, m) {
    let balance = 0, wins = 0, losses = 0, total = 0, inTrade = false, entry = 0, type = null;
    const mult = 40, stake = 10;

    for (let i = m; i < ticks.length; i++) {
        if (!inTrade) {
            const last = ticks.slice(i - m, i);
            if (last.every((v, idx) => idx === 0 || v < last[idx - 1])) { inTrade = true; type = 'UP'; entry = ticks[i]; }
            else if (last.every((v, idx) => idx === 0 || v > last[idx - 1])) { inTrade = true; type = 'DOWN'; entry = ticks[i]; }
        } else {
            let diff = (ticks[i] - entry) / entry;
            if (type === 'DOWN') diff = -diff;
            const p = diff * mult * stake;
            if (p >= tp) { wins++; total++; balance += tp; inTrade = false; i += 30; }
            else if (p <= -sl) { losses++; total++; balance -= sl; inTrade = false; i += 30; }
        }
    }

    const wr = (wins / total) * 100 || 0;
    console.log(`${name}:`);
    console.log(`   Trades: ${total} | WR: ${wr.toFixed(1)}% | PnL: $${balance.toFixed(2)}`);
    console.log(`----------------------------------------------------------`);
}
