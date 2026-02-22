const WebSocket = require('ws');

// CONFIG
const APP_ID = 1089;
const SYMBOL = 'R_100'; // Volatility 100
const DYNAMIC_CONFIG = {
    stake: 3,
    takeProfit: 0.30,
    multiplier: 40,
    momentum: 5
};

const hours = 24;
const endTime = Math.floor(Date.now() / 1000);
const startTime = endTime - (hours * 60 * 60);

console.log(`🚀 Iniciando Backtest DYNAMIC para ${SYMBOL}`);
console.log(`⏰ Periodo: Últimas ${hours} horas`);

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

ws.on('open', () => {
    ws.send(JSON.stringify({
        ticks_history: SYMBOL,
        adjust_start_time: 1,
        start: startTime,
        end: 'latest',
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
        const times = msg.history.times;
        console.log(`📊 Datos recibidos: ${prices.length} ticks.`);

        runSimulation(prices);
        ws.close();
    }
});

function runSimulation(ticks) {
    let balance = 0;
    let totalTrades = 0;
    let wins = 0;
    let losses = 0;
    let tradeLog = [];

    // Variables de estado del trade
    let inTrade = false;
    let entryPrice = 0;
    let tradeType = null; // 'MULTUP' o 'MULTDOWN'
    let tickCounter = 0;

    for (let i = DYNAMIC_CONFIG.momentum; i < ticks.length; i++) {
        const currentPrice = ticks[i];

        if (!inTrade) {
            // Lógica DYNAMIC: 3 ticks seguidos en una dirección -> Contrapuesta
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
            // Simulación de Profit/Loss con Multiplicador
            // Profit = (PriceChange / EntryPrice) * Multiplier * Stake
            let priceChangePct = (currentPrice - entryPrice) / entryPrice;
            if (tradeType === 'MULTDOWN') priceChangePct = -priceChangePct;

            const currentProfit = priceChangePct * DYNAMIC_CONFIG.multiplier * DYNAMIC_CONFIG.stake;

            // Criterios de salida
            let exitReason = null;
            if (currentProfit >= DYNAMIC_CONFIG.takeProfit) {
                exitReason = 'TAKE PROFIT';
            } else if (currentProfit <= -DYNAMIC_CONFIG.stake) { // Stop Loss total del stake (típico en multiplicadores)
                exitReason = 'STOP LOSS (STAKE)';
            }

            if (exitReason) {
                totalTrades++;
                const finalProfit = (exitReason === 'TAKE PROFIT') ? DYNAMIC_CONFIG.takeProfit : -DYNAMIC_CONFIG.stake;
                if (finalProfit > 0) wins++; else losses++;
                balance += finalProfit;

                inTrade = false;
                // Cooldown simulado (15 ticks para evitar re-entradas inmediatas)
                i += 15;
            }
        }
    }

    console.log(`\n============== RESULTADOS BACKTEST (2H) ==============`);
    console.log(`Estrategia: DYNAMIC (Momentum ${DYNAMIC_CONFIG.momentum})`);
    console.log(`Operaciones Totales: ${totalTrades}`);
    console.log(`Victorias: ${wins} ✅`);
    console.log(`Derrotas: ${losses} ❌`);
    console.log(`Win Rate: ${((wins / totalTrades) * 100).toFixed(1)}%`);
    console.log(`PnL Total: $${balance.toFixed(2)}`);
    console.log(`====================================================\n`);
}
