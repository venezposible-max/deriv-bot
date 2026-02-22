```javascript
const WebSocket = require('ws');

// CONFIG
const APP_ID = 1089;
const SYMBOL = 'stpRNG';

const DYNAMIC_CONFIG = {
    stake: 0.1, // Mínimo para Step Index
    takeProfit: 0.1,
    multiplier: 1, // Step Index suele no usar multiplicador de la misma forma, pero Deriv API lo pide si es Multiplier contract
    momentum: 7,
    stopLoss: 0.5
};

const hours = 24;
const totalNeeded = 30000;

let allTicks = [];
let lastEndTime = Math.floor(Date.now() / 1000);

const OPTION_7 = { momentum: 7, takeProfit: 0.30, stopLoss: 3.00, stake: 10, multiplier: 40 };

console.log(`🚀 Iniciando Backtest Comparativo(Últimas ${ hours }h) para ${ SYMBOL } `);

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
            console.log(`\n✅ Datos cargados. Iniciando simulación...`);
            runMultiSimulation(allTicks);
            ws.close();
        }
    }
});

function runMultiSimulation(ticks) {
    console.log(`\n--- RESULTADOS CARGADOS (${ticks.length} ticks) ---`);

    simulate("MOMENTUM 7 (Equilibrado)", OPTION_7, ticks);
}

function simulate(label, config, ticks) {
    let balance = 0;
    let wins = 0;
    let losses = 0;
    let totalTrades = 0;
    let inTrade = false;
    let entryPrice = 0;
    let tradeType = null;

    for (let i = config.momentum; i < ticks.length; i++) {
        const currentPrice = ticks[i];

        if (!inTrade) {
            const lastTicks = ticks.slice(i - config.momentum, i);
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

            const currentProfit = priceChangePct * config.multiplier * config.stake;

            if (currentProfit >= config.takeProfit) {
                wins++;
                totalTrades++;
                balance += config.takeProfit;
                inTrade = false;
                i += 30; // Cooldown
            } else if (currentProfit <= -config.stopLoss) {
                losses++;
                totalTrades++;
                balance -= config.stopLoss;
                inTrade = false;
                i += 30; // Cooldown
            }
        }
    }

    console.log(`\n📊 ${label}`);
    console.log(`Operaciones: ${totalTrades}`);
    console.log(`Wins: ${wins} | Losses: ${losses}`);
    console.log(`Win Rate: ${((wins / totalTrades) * 100 || 0).toFixed(1)}%`);
    console.log(`PnL Total: $${balance.toFixed(2)}`);
    console.log(`-----------------------------------`);
}
