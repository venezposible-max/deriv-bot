const WebSocket = require('ws');

// CONFIG
const APP_ID = 1089;
const SYMBOL = 'R_100'; // Volatility 100
const DYNAMIC_CONFIG = {
    stake: 10,
    takeProfit: 1.0,  // Meta de $1.00
    multiplier: 40,
    momentum: 5,
    stopLoss: 10.0
};

const hours = 10; // Reducimos a 10h pero con alta densidad
const endTime = Math.floor(Date.now() / 1000);
const startTime = endTime - (hours * 60 * 60);

console.log(`🚀 Iniciando Backtest DYNAMIC ULTRA (Filtros H1 + Speed + Trailing)`);
console.log(`⏰ Periodo: Últimas ${hours} horas`);

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

ws.on('open', () => {
    ws.send(JSON.stringify({
        ticks_history: SYMBOL,
        adjust_start_time: 1,
        count: 50000,
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
        console.log(`📊 Ticks recibidos: ${prices.length}`);
        runSimulation(prices, times);
        ws.close();
    }
});

function calculateSMA(data, period) {
    if (data.length < period) return null;
    let sum = 0;
    for (let i = 0; i < period; i++) sum += data[data.length - 1 - i];
    return sum / period;
}

function runSimulation(ticks, times) {
    let balance = 0;
    let totalTrades = 0;
    let wins = 0;
    let losses = 0;

    let h1Candles = [];
    let currentCandle = { startEpoch: times[0] };

    // Estado del trade
    let inTrade = false;
    let entryPrice = 0;
    let tradeType = null;
    let currentMaxProfit = 0;
    let lastSlAssigned = -10;

    for (let i = 100; i < ticks.length; i++) {
        const currentPrice = ticks[i];
        const currentTime = times[i];

        // Mantenimiento de Velas M1 para el filtro (60s)
        if (currentTime - currentCandle.startEpoch >= 60) {
            h1Candles.push(currentPrice);
            if (h1Candles.length > 50) h1Candles.shift();
            currentCandle = { startEpoch: currentTime };
        }

        if (!inTrade) {
            // 1. Filtro de Tendencia M1 (SMA 20/40)
            let trend = 'NEUTRAL';
            if (h1Candles.length >= 40) {
                const s20 = calculateSMA(h1Candles, 20);
                const s40 = calculateSMA(h1Candles, 40);
                if (s20 && s40) trend = s20 > s40 ? 'UP' : 'DOWN';
            }

            // 2. Lógica DYNAMIC
            const lastTicks = ticks.slice(i - DYNAMIC_CONFIG.momentum, i);
            const allDown = lastTicks.every((v, idx) => idx === 0 || v <= lastTicks[idx - 1]);
            const allUp = lastTicks.every((v, idx) => idx === 0 || v >= lastTicks[idx - 1]);

            // 3. Velocidad
            const timeDiff = times[i] - times[i - DYNAMIC_CONFIG.momentum];
            const isFastEnough = timeDiff <= 2.0;

            let signal = null;
            if (allDown && trend === 'UP' && isFastEnough) signal = 'MULTUP';
            if (allUp && trend === 'DOWN' && isFastEnough) signal = 'MULTDOWN';

            if (signal) {
                inTrade = true;
                tradeType = signal;
                entryPrice = currentPrice;
                currentMaxProfit = 0;
                lastSlAssigned = -10;
                totalTrades++;
            }
        } else {
            // Simulación de Profit/Loss
            let priceChangePct = (currentPrice - entryPrice) / entryPrice;
            if (tradeType === 'MULTDOWN') priceChangePct = -priceChangePct;
            const currentProfit = priceChangePct * DYNAMIC_CONFIG.multiplier * DYNAMIC_CONFIG.stake;

            if (currentProfit > currentMaxProfit) currentMaxProfit = currentProfit;

            // Lógica Micro-Asegurador
            if (currentMaxProfit >= 0.30 && lastSlAssigned < 0.15) lastSlAssigned = 0.15;
            if (currentMaxProfit >= 0.55 && lastSlAssigned < 0.35) lastSlAssigned = 0.35;

            // Criterios de salida
            let exit = false;
            let finalProfit = 0;

            if (currentProfit >= DYNAMIC_CONFIG.takeProfit) {
                exit = true;
                finalProfit = currentProfit;
            } else if (lastSlAssigned > -10 && currentProfit <= lastSlAssigned) {
                exit = true;
                finalProfit = currentProfit;
            } else if (currentProfit <= -DYNAMIC_CONFIG.stopLoss) {
                exit = true;
                finalProfit = currentProfit;
            }

            if (exit) {
                if (finalProfit > 0) wins++; else losses++;
                balance += finalProfit;
                console.log(`🏁 Trade ${totalTrades}: ${finalProfit > 0 ? 'GANADA ✅' : 'PERDIDA ❌'} | Profit: $${finalProfit.toFixed(2)} | Max: $${currentMaxProfit.toFixed(2)}`);
                inTrade = false;
                i += 20; // Cooldown
            }
        }
    }

    console.log(`\n============== RESULTADOS BACKTEST ESTRATEGIA ULTRA ==============`);
    console.log(`Filtros: Tendencia M1 + Velocidad Ticks + Micro-Asegurador`);
    console.log(`------------------------------------------------------------------`);
    console.log(`Operaciones Totales: ${totalTrades}`);
    console.log(`Victorias: ${wins} ✅`);
    console.log(`Derrotas: ${losses} ❌`);
    console.log(`PnL Total: $${balance.toFixed(2)}`);
    console.log(`==================================================================\n`);
    process.exit(0);
}
