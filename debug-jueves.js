const WebSocket = require('ws');
const APP_ID = 1089;
const SYMBOL = 'stpRNG';

const endOfThursday = Math.floor(new Date('2026-03-05T23:59:59Z').getTime() / 1000);
const startOfThursday = endOfThursday - (24 * 3600);

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
let allTicks = [];

ws.on('open', () => {
    console.log(`\n📥 DEBUG BACKTEST: JUEVES 5...`);
    fetchTicks(startOfThursday, endOfThursday);
});

function fetchTicks(s, e) {
    ws.send(JSON.stringify({ ticks_history: SYMBOL, start: s, end: e, count: 5000, style: 'ticks' }));
}

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.msg_type === 'history') {
        const chunk = msg.history.prices || [];
        const times = msg.history.times || [];

        if (chunk.length === 0) { console.log("Final: 0 ticks."); runSim(); ws.close(); return; }

        allTicks = allTicks.concat(chunk);
        const last = times[times.length - 1];

        console.log(`Debug: Received ${chunk.length} ticks. Range: ${times[0]} to ${last}. Target End: ${endOfThursday}`);

        if (last < endOfThursday && allTicks.length < 500000) { // Safety limit
            fetchTicks(last + 1, endOfThursday);
        } else {
            console.log(`✅ Carga terminada. Total: ${allTicks.length}`);
            runSim();
            ws.close();
        }
    }
});

function runSim() {
    let bal = 0, wins = 0, losses = 0, trades = 0;
    const TP = 2.0, SL = 3.0;

    for (let i = 250; i < allTicks.length - 10; i++) {
        const last3 = allTicks.slice(i - 3, i);
        if (last3.every((v, j) => j === 0 || v > last3[j - 1])) {
            trades++;
            let exit = null;
            for (let k = i + 10; k < allTicks.length; k++) {
                let p = (allTicks[k] - allTicks[i + 10]) * 7.5;
                if (p >= TP) { exit = TP; break; }
                if (p <= -SL) { exit = -SL; break; }
            }
            if (exit) { bal += exit; if (exit > 0) wins++; else losses++; }
        }
    }
    console.log(`Result: $${bal.toFixed(2)} | Wins: ${wins} | Loss: ${losses}`);
}
