const WebSocket = require('ws');

// CONFIG
const APP_ID = 1089;
const SYMBOL = 'frxXAUUSD';

// Parámetros de prueba sugeridos
const CONFIG = {
    momentum: 7,
    takeProfit: 0.30,
    stopLoss: 3.00,
    stake: 10,
    multiplier: 40
};

// JUEVES PASADO: 19 de Febrero de 2026
// Inicio: 2026-02-19 00:00:00 UTC
// Fin: 2026-02-19 23:59:59 UTC
const startTS = Math.floor(new Date('2026-02-19T00:00:00Z').getTime() / 1000);
const endTS = Math.floor(new Date('2026-02-19T23:59:59Z').getTime() / 1000);

let allTicks = [];
let nextEndTime = endTS;

console.log(`🚀 Iniciando Backtest ORO (frxXAUUSD) para el Jueves 19/Feb`);
console.log(`⏰ Periodo: 24 horas (Mercado abierto)`);

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

ws.on('open', () => {
    fetchBatch();
});

function fetchBatch() {
    ws.send(JSON.stringify({
        ticks_history: SYMBOL,
        end: nextEndTime,
        start: startTS,
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
        const prices = msg.history.prices;
        const times = msg.history.times;

        if (prices.length > 0) {
            allTicks = prices.concat(allTicks);
            nextEndTime = times[0] - 1;
            console.log(`📥 Cargando datos... (${allTicks.length} ticks recuperados)`);

            if (nextEndTime > startTS) {
                fetchBatch();
            } else {
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
    if (ticks.length < 100) {
        console.log("❌ No hay suficientes datos para simular.");
        return;
    }

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
                tradeType = 'MULTUP';
                entryPrice = currentPrice;
            } else if (allUp) {
                inTrade = true;
                tradeType = 'MULTDOWN';
                entryPrice = currentPrice;
            }
        } else {
            let priceChangePct = (currentPrice - entryPrice) / entryPrice;
            if (tradeType === 'MULTDOWN') priceChangePct = -priceChangePct;

            const currentProfit = priceChangePct * CONFIG.multiplier * CONFIG.stake;

            if (currentProfit >= CONFIG.takeProfit) {
                wins++;
                totalTrades++;
                balance += CONFIG.takeProfit;
                inTrade = false;
                i += 30; // Cooldown
            } else if (currentProfit <= -CONFIG.stopLoss) {
                losses++;
                totalTrades++;
                balance -= CONFIG.stopLoss;
                inTrade = false;
                i += 30; // Cooldown
            }
        }
    }

    console.log(`\n============== RESULTADOS ORO (JUEVES) ==============`);
    console.log(`Ticks Analizados: ${ticks.length}`);
    console.log(`Operaciones Totales: ${totalTrades}`);
    console.log(`Victorias: ${wins} ✅`);
    console.log(`Derrotas: ${losses} ❌`);
    console.log(`Win Rate: ${((wins / totalTrades) * 100 || 0).toFixed(1)}%`);
    console.log(`PnL Total: $${balance.toFixed(2)}`);
    console.log(`====================================================\n`);
}
