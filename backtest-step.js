const WebSocket = require('ws');

// CONFIG
const APP_ID = 1089;
const SYMBOL = 'stpRNG'; // Step Index
const hours = 24;
const totalNeeded = 50000;

let allTicks = [];
let lastEndTime = Math.floor(Date.now() / 1000);

// Configuración para Step Index (usa puntos, no multiplicador en la misma escala)
// Un movimiento de "1 step" es 0.1 en precio.
// Para este backtest simularemos el profit como la diferencia directa de precio.
const CONFIG = { momentum: 7, targetPoints: 0.3, stopPoints: 1.0, stake: 0.1 };

console.log(`🚀 Iniciando Backtest Step Index (Últimas ${hours}h) para ${SYMBOL}`);

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

ws.on('open', () => {
    fetchBatch();
});

function fetchBatch() {
    ws.send(JSON.stringify({
        ticks_history: SYMBOL,
        end: lastEndTime,
        count: 5000,
        style: 'ticks'
    }));
}

ws.on('message', (data) => {
    const msg = JSON.parse(data);

    if (msg.error) {
        console.error('❌ Error:', msg.error.message);
        process.exit(1);
    }

    if (msg.msg_type === 'history') {
        allTicks = msg.history.prices.concat(allTicks);
        lastEndTime = msg.history.times[0] - 1;

        console.log(`📥 Cargando datos... (${allTicks.length} ticks recuperados)`);

        if (allTicks.length < totalNeeded && msg.history.prices.length > 0) {
            fetchBatch();
        } else {
            console.log(`\n✅ Datos cargados. Simulando...`);
            runStepSimulation(allTicks);
            ws.close();
        }
    }
});

function runStepSimulation(ticks) {
    let balance = 0;
    let wins = 0;
    let losses = 0;
    let totalTrades = 0;
    let inTrade = false;
    let entryPrice = 0;
    let tradeType = null;

    for (let i = CONFIG.momentum; i < ticks.length; i++) {
        const currentPrice = ticks[i];

        if (!inTrade) {
            const lastTicks = ticks.slice(i - CONFIG.momentum, i);
            const allDown = lastTicks.every((v, idx) => idx === 0 || v < lastTicks[idx - 1]);
            const allUp = lastTicks.every((v, idx) => idx === 0 || v > lastTicks[idx - 1]);

            if (allDown) {
                inTrade = true;
                tradeType = 'UP';
                entryPrice = currentPrice;
            } else if (allUp) {
                inTrade = true;
                tradeType = 'DOWN';
                entryPrice = currentPrice;
            }
        } else {
            // En Step Index calculamos el profit por diferencia de puntos
            let diff = currentPrice - entryPrice;
            if (tradeType === 'DOWN') diff = -diff;

            if (diff >= CONFIG.targetPoints) {
                wins++;
                totalTrades++;
                balance += 1; // Un ratio de ganancia
                inTrade = false;
                i += 20;
            } else if (diff <= -CONFIG.stopPoints) {
                losses++;
                totalTrades++;
                balance -= 10; // Una perdida mayor por el stop loss
                inTrade = false;
                i += 20;
            }
        }
    }

    console.log(`\n📊 RESULTADOS STEP INDEX (M7)`);
    console.log(`Operaciones: ${totalTrades}`);
    console.log(`Wins: ${wins} | Losses: ${losses}`);
    console.log(`Win Rate: ${((wins / totalTrades) * 100 || 0).toFixed(1)}%`);
    console.log(`-----------------------------------`);
}
