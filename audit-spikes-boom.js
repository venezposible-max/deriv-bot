const WebSocket = require('ws');
const APP_ID = 1089;
const SYMBOL = 'BOOM1000';

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
let allTicks = [];
const TOTAL_TICKS_NEEDED = 50000;

ws.on('open', () => {
    console.log(`\n📊 AUDITANDO TAMAÑO DE SPIKES EN BOOM 1000...`);
    fetchTicks();
});

function fetchTicks(beforeEpoch = 'latest') {
    ws.send(JSON.stringify({ ticks_history: SYMBOL, end: beforeEpoch || 'latest', count: 5000, style: 'ticks' }));
}

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.msg_type === 'history') {
        const chunk = msg.history.prices || [];
        const times = msg.history.times || [];
        allTicks = [...chunk, ...allTicks];
        if (allTicks.length < TOTAL_TICKS_NEEDED && chunk.length > 0) {
            process.stdout.write('.');
            fetchTicks(times[0]);
        } else {
            console.log(`\n✅ DATA CARGADA. Analizando distribución de movimientos...`);
            analyzeSpikeDistribution();
            ws.close();
        }
    }
});

function analyzeSpikeDistribution() {
    let spikes = [];
    for (let i = 1; i < allTicks.length; i++) {
        const move = allTicks[i] - allTicks[i - 1];
        if (move > 0.5) { // Definimos un spike como un salto > 0.5 puntos
            spikes.push(move);
        }
    }

    spikes.sort((a, b) => a - b);

    const small = spikes.filter(s => s >= 0.5 && s < 2.0).length;
    const medium = spikes.filter(s => s >= 2.0 && s < 5.0).length;
    const large = spikes.filter(s => s >= 5.0 && s < 10.0).length;
    const mega = spikes.filter(s => s >= 10.0).length;

    console.log("\n=========================================");
    console.log("📊 DISTRIBUCIÓN DE SPIKES (BOOM 1000)");
    console.log("=========================================");
    console.log(`Total Spikes detectados: ${spikes.length}`);
    console.log(`- Pequeños (0.5 - 2.0 pts): ${small} (${((small / spikes.length) * 100).toFixed(1)}%)`);
    console.log(`- Medianos (2.0 - 5.0 pts): ${medium} (${((medium / spikes.length) * 100).toFixed(1)}%)`);
    console.log(`- Grandes (5.0 - 10.0 pts): ${large} (${((large / spikes.length) * 100).toFixed(1)}%)`);
    console.log(`- mega Spikes (> 10.0 pts): ${mega} (${((mega / spikes.length) * 100).toFixed(1)}%)`);
    console.log("-----------------------------------------");
    console.log(`Salto Máximo Detectado: ${Math.max(...spikes).toFixed(2)} pts`);
    console.log(`Salto Promedio: ${(spikes.reduce((a, b) => a + b, 0) / spikes.length).toFixed(2)} pts`);
    console.log("=========================================\n");
}
