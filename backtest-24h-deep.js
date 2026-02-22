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
            console.log(`📥 Cargando datos de 24h... (${allTicks.length} ticks)`);
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
    console.log(`\n📊 ANÁLISIS PROFUNDO DE 24 HORAS (${ticks.length} ticks)`);
    console.log(`==========================================================`);

    test("OPCIÓN 2 (TU ELECCIÓN: TP 1.0, SL 1.5, M8)", ticks, 1.00, 1.50, 8);
    test("MI SUGERENCIA (TP 0.5, SL 1.0, M6)", ticks, 0.50, 1.00, 6);
    test("TU PROPUESTA ORIGINAL (TP 0.5, SL 2.0, M5)", ticks, 0.50, 2.00, 5);
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
