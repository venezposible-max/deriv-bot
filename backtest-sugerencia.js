const WebSocket = require('ws');

// CONFIG SEGÚN SUGERENCIA
const APP_ID = 1089;
const SYMBOL = 'R_100'; // Volatilidad 100
const CONFIG = {
    stake: 10,
    takeProfit: 0.50,
    stopLoss: 1.00,
    multiplier: 40,
    momentum: 6 // Usamos Momentum 6 para mayor filtrado
};

const hours = 4;
const endTime = Math.floor(Date.now() / 1000);
const startTime = endTime - (hours * 60 * 60);

console.log(`\n🔍 EJECUTANDO BACKTEST: CONFIGURACIÓN SUGERIDA (V100)`);
console.log(`--------------------------------------------------`);
console.log(`Mercado: ${SYMBOL}`);
console.log(`Periodo: Últimas ${hours} horas`);
console.log(`Parámetros: TP=$${CONFIG.takeProfit} | SL=$${CONFIG.stopLoss} | M=${CONFIG.momentum}`);
console.log(`--------------------------------------------------\n`);

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

ws.on('open', () => {
    ws.send(JSON.stringify({
        ticks_history: SYMBOL,
        adjust_start_time: 1,
        start: startTime,
        end: 'latest',
        count: 10000,
        style: 'ticks'
    }));
});

ws.on('message', (data) => {
    const msg = JSON.parse(data);

    if (msg.error) {
        console.error('❌ Error de Deriv:', msg.error.message);
        process.exit(1);
    }

    if (msg.msg_type === 'history') {
        const prices = msg.history.prices;
        if (!prices || prices.length === 0) {
            console.log("❌ No se recibieron datos del historial.");
            process.exit(1);
        }
        console.log(`📊 Datos cargados: ${prices.length} ticks.`);
        runSimulation(prices);
        ws.close();
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
                i += 30; // Cooldown de 30 ticks
            } else if (currentProfit <= -CONFIG.stopLoss) {
                losses++;
                totalTrades++;
                balance -= CONFIG.stopLoss;
                inTrade = false;
                i += 30; // Cooldown de 30 ticks
            }
        }
    }

    console.log(`\n🏆 RESULTADOS FINALES:`);
    console.log(`--------------------------------------------------`);
    console.log(`Operaciones Totales: ${totalTrades}`);
    console.log(`Victorias: ${wins} ✅`);
    console.log(`Derrotas: ${losses} ❌`);
    console.log(`Win Rate: ${((wins / totalTrades) * 100 || 0).toFixed(1)}%`);
    console.log(`PnL Total: $${balance.toFixed(2)}`);
    console.log(`--------------------------------------------------\n`);
}
