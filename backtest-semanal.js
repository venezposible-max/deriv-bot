const WebSocket = require('ws');

const APP_ID = 1089;
const SYMBOL = 'R_100';
const days = 7;
const hours = days * 24;
const endTime = Math.floor(Date.now() / 1000);
const startTime = endTime - (hours * 60 * 60);

let allTicks = [];
let nextEnd = endTime;

console.log(`\n📅 INICIANDO BACKTEST SEMANAL (V100)`);
console.log(`-----------------------------------`);
console.log(`Periodo: ${days} días`);
console.log(`Estrategia: HÍBRIDO (TP 0.6 | SL 0.6 | M7)`);
console.log(`-----------------------------------\n`);

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

            // Actualizar progreso
            if (allTicks.length % 25000 === 0 || prices.length < 5000) {
                console.log(`📥 Descargando historial... (${allTicks.length} ticks recuperados)`);
            }

            if (nextEnd > startTime && allTicks.length < 500000) { // Límite de seguridad
                fetchBatch();
            } else {
                console.log(`✅ Carga completa. Procesando simulación...`);
                runSimulation(allTicks);
                ws.close();
            }
        } else {
            runSimulation(allTicks);
            ws.close();
        }
    }
});

function runSimulation(ticks) {
    let balance = 0, wins = 0, losses = 0, total = 0, inTrade = false, entry = 0, type = null;
    const mult = 40, stake = 10;
    const tp = 0.60, sl = 0.60, m = 7;

    for (let i = m; i < ticks.length; i++) {
        if (!inTrade) {
            const last = ticks.slice(i - m, i);
            const allDown = last.every((v, idx) => idx === 0 || v < last[idx - 1]);
            const allUp = last.every((v, idx) => idx === 0 || v > last[idx - 1]);

            if (allDown) {
                inTrade = true;
                type = 'UP';
                entry = ticks[i];
            } else if (allUp) {
                inTrade = true;
                type = 'DOWN';
                entry = ticks[i];
            }
        } else {
            let diff = (ticks[i] - entry) / entry;
            if (type === 'DOWN') diff = -diff;
            const p = diff * mult * stake;

            if (p >= tp) {
                wins++; total++; balance += tp; inTrade = false; i += 30;
            } else if (p <= -sl) {
                losses++; total++; balance -= sl; inTrade = false; i += 30;
            }
        }
    }

    const wr = (wins / total) * 100 || 0;
    console.log(`\n🏆 RESULTADOS FINALES DE LA SEMANA:`);
    console.log(`==========================================================`);
    console.log(`   Ticks Totales: ${ticks.length}`);
    console.log(`   Operaciones: ${total}`);
    console.log(`   Victorias: ${wins} ✅`);
    console.log(`   Derrotas: ${losses} ❌`);
    console.log(`   Win Rate: ${wr.toFixed(1)}%`);
    console.log(`   PnL Neto: $${balance.toFixed(2)}`);
    console.log(`   Rendimiento: ${((balance / stake) * 100).toFixed(1)}% sobre stake`);
    console.log(`==========================================================\n`);
}
