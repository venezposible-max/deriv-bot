const WebSocket = require('ws');

// CONFIG SEGÚN SUGERENCIA
const APP_ID = 1089;
const SYMBOL = 'R_100';
const hours = 24;
const endTime = Math.floor(Date.now() / 1000);
const startTime = endTime - (hours * 60 * 60);

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

ws.on('open', () => {
    ws.send(JSON.stringify({
        ticks_history: SYMBOL,
        adjust_start_time: 1,
        start: startTime,
        end: 'latest',
        count: 100000,
        style: 'ticks'
    }));
});

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.msg_type === 'history') {
        const prices = msg.history.prices;
        console.log(`\n📊 COMPARATIVA DE ESTRATEGIAS (Últimas ${hours}h - ${prices.length} ticks)`);
        console.log(`==========================================================`);

        // Ejecutar diferentes escenarios
        test("TU PROPUESTA (RIESGO ALTO)", prices, 0.50, 2.00, 5);
        test("MI SUGERENCIA (EQUILIBRADA)", prices, 0.50, 1.00, 6);
        test("OPCIÓN SNIPER (RATIO 1:1)", prices, 1.00, 1.00, 8);
        test("OPCIÓN 'SCALPER' (RATIO 1:1.5)", prices, 0.50, 0.75, 7);

        ws.close();
    }
});

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
            if (p >= tp) { wins++; total++; balance += tp; inTrade = false; i += 20; }
            else if (p <= -sl) { losses++; total++; balance -= sl; inTrade = false; i += 20; }
        }
    }

    const wr = (wins / total) * 100 || 0;
    console.log(`${name}:`);
    console.log(`   Trades: ${total} | WR: ${wr.toFixed(1)}% | PnL: $${balance.toFixed(2)}`);
    console.log(`----------------------------------------------------------`);
}
