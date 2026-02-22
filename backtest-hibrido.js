const WebSocket = require('ws');

const APP_ID = 1089;
const SYMBOL = 'R_100';
const hours = 8; // Analizamos las últimas 8 horas (el turno más reciente)
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
            if (nextEnd > startTime && allTicks.length < 20000) {
                fetchBatch();
            } else {
                runAnalysis(allTicks);
                ws.close();
            }
        } else {
            runAnalysis(allTicks);
            ws.close();
        }
    }
});

function runAnalysis(ticks) {
    console.log(`\n🧪 BACKTEST: HÍBRIDO GANADOR - ÚLTIMAS ${hours} HORAS`);
    console.log(`==========================================================`);

    // Parámetros Híbrido: TP 0.6, SL 0.6, M7
    test("ESTRATEGIA HÍBRIDA (TP 0.6 | SL 0.6 | M7)", ticks, 0.60, 0.60, 7);
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
    console.log(`   Trades: ${total} | Victorias: ${wins} | Derrotas: ${losses}`);
    console.log(`   Win Rate: ${wr.toFixed(1)}%`);
    console.log(`   PnL Neto: $${balance.toFixed(2)}`);
    console.log(`==========================================================\n`);
}
