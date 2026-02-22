const WebSocket = require('ws');

// CONFIG
const APP_ID = 1089;
const SYMBOL = 'R_100';
const DYNAMIC_CONFIG = {
    stake: 10,
    takeProfit: 0.30,
    multiplier: 40,
    momentum: 5 // Cambiado a 5 como sugerido
};

const hours = 24;
const totalNeeded = 40000; // Estimado para 24h
let allTicks = [];
let lastEndTime = Math.floor(Date.now() / 1000);

console.log(`🚀 Iniciando Backtest DYNAMIC Pro (Paginado) para ${SYMBOL}`);
console.log(`⏰ Periodo: Últimas ${hours} horas`);

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
        const prices = msg.history.prices;
        const times = msg.history.times;

        allTicks = prices.concat(allTicks);
        lastEndTime = times[0] - 1;

        console.log(`📥 Cargando datos... (${allTicks.length} ticks recuperados)`);

        if (allTicks.length < totalNeeded && prices.length > 0) {
            fetchBatch();
        } else {
            runSimulation(allTicks);
            ws.close();
        }
    }
});

function runSimulation(ticks) {
    let balance = 0;
    let totalTrades = 0;
    let wins = 0;
    let losses = 0;

    let inTrade = false;
    let entryPrice = 0;
    let tradeType = null;

    for (let i = DYNAMIC_CONFIG.momentum; i < ticks.length; i++) {
        const currentPrice = ticks[i];

        if (!inTrade) {
            const lastTicks = ticks.slice(i - DYNAMIC_CONFIG.momentum, i);
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

            const currentProfit = priceChangePct * DYNAMIC_CONFIG.multiplier * DYNAMIC_CONFIG.stake;

            if (currentProfit >= DYNAMIC_CONFIG.takeProfit) {
                totalTrades++;
                wins++;
                balance += DYNAMIC_CONFIG.takeProfit;
                inTrade = false;
                i += 30; // Cooldown de seguridad aumentado
            } else if (currentProfit <= -DYNAMIC_CONFIG.stake) {
                totalTrades++;
                losses++;
                balance -= DYNAMIC_CONFIG.stake;
                inTrade = false;
                i += 30;
            }
        }
    }

    console.log(`\n============== RESULTADOS 24H (DYNAMIC 5) ==============`);
    console.log(`Ticks Analizados: ${ticks.length}`);
    console.log(`Operaciones Totales: ${totalTrades}`);
    console.log(`Victorias: ${wins} ✅`);
    console.log(`Derrotas: ${losses} ❌`);
    console.log(`Win Rate: ${((wins / totalTrades) * 100).toFixed(1)}%`);
    console.log(`PnL Total: $${balance.toFixed(2)}`);
    console.log(`Rendimiento Promedio: $${(balance / totalTrades).toFixed(4)} por trade`);
    console.log(`====================================================\n`);
}
