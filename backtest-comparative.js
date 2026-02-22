const WebSocket = require('ws');

// CONFIG
const APP_ID = 1089;
const SYMBOL = 'R_100'; // Volatilidad 100
const hours = 0.25; // 15 minutos
const totalNeeded = 1000;

let allTicks = [];
let lastEndTime = Math.floor(Date.now() / 1000);

const OPTION_7 = { momentum: 7, takeProfit: 0.30, stopLoss: 3.00, stake: 10, multiplier: 40 };

console.log(`🚀 Iniciando Backtest Ultra-Rápido (Últimos 15 min) para ${SYMBOL}`);

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

        if (allTicks.length < totalNeeded && msg.history.prices.length > 0) {
            fetchBatch();
        } else {
            // Solo nos interesan los ultimos totalNeeded ticks (15 mins aprox)
            const recentTicks = allTicks.slice(-totalNeeded);
            runSimulation(recentTicks);
            ws.close();
        }
    }
});

function runSimulation(ticks) {
    let balance = 0;
    let wins = 0;
    let losses = 0;
    let totalTrades = 0;
    let inTrade = false;
    let entryPrice = 0;
    let tradeType = null;
    let cooldownUntil = 0;

    for (let i = OPTION_7.momentum; i < ticks.length; i++) {
        const currentPrice = ticks[i];

        if (!inTrade && i >= cooldownUntil) {
            const lastTicks = ticks.slice(i - OPTION_7.momentum, i);
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
        } else if (inTrade) {
            let priceChangePct = (currentPrice - entryPrice) / entryPrice;
            if (tradeType === 'MULTDOWN') priceChangePct = -priceChangePct;

            const currentProfit = priceChangePct * OPTION_7.multiplier * OPTION_7.stake;

            if (currentProfit >= OPTION_7.takeProfit) {
                wins++;
                totalTrades++;
                balance += OPTION_7.takeProfit;
                inTrade = false;
                cooldownUntil = i + 60; // Enfriamiento de 60 ticks (aprox 1 min)
            } else if (currentProfit <= -OPTION_7.stopLoss) {
                losses++;
                totalTrades++;
                balance -= OPTION_7.stopLoss;
                inTrade = false;
                cooldownUntil = i + 60; // Enfriamiento de 60 ticks
            }
        }
    }

    console.log(`\n============== RESULTADOS 15 MIN (M7) ==============`);
    console.log(`Ticks Analizados: ${ticks.length}`);
    console.log(`Operaciones Totales: ${totalTrades}`);
    console.log(`Victorias: ${wins} ✅`);
    console.log(`Derrotas: ${losses} ❌`);
    console.log(`Win Rate: ${((wins / totalTrades) * 100 || 0).toFixed(1)}%`);
    console.log(`PnL Total: $${balance.toFixed(2)}`);
    console.log(`====================================================\n`);
}
