const WebSocket = require('ws');
const APP_ID = 1089;
const SYMBOL = 'R_100';

const DYNAMIC_CONFIG = {
    stake: 10,
    takeProfit: 1.0,
    multiplier: 40,
    momentum: 5,
    stopLoss: 10.0
};

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
    if (msg.msg_type === 'history') {
        runSimulation(msg.history.prices, msg.history.times);
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
    let inTrade = false;
    let entryPrice = 0;
    let tradeType = null;
    let currentMaxProfit = 0;
    let lastSlAssigned = -10;
    let tickIntervals = [];
    let lastTickUpdate = times[0] * 1000;

    for (let i = 100; i < ticks.length; i++) {
        const currentPrice = ticks[i];
        const currentTime = times[i];

        // Simular intervalos de ticks (basado en el tiempo real entre ticks)
        const currentTickMs = currentTime * 1000;
        const interval = currentTickMs - lastTickUpdate;
        tickIntervals.push(interval > 0 ? interval : 200); // 200ms default if same epoch
        if (tickIntervals.length > 10) tickIntervals.shift();
        lastTickUpdate = currentTickMs;

        if (currentTime - currentCandle.startEpoch >= 60) {
            h1Candles.push(currentPrice);
            if (h1Candles.length > 50) h1Candles.shift();
            currentCandle = { startEpoch: currentTime };
        }

        if (!inTrade) {
            let trend = 'NEUTRAL';
            if (h1Candles.length >= 20) {
                const s10 = calculateSMA(h1Candles, 10);
                const s20 = calculateSMA(h1Candles, 20);
                if (s10 && s20) trend = s10 > s20 ? 'UP' : 'DOWN';
            }

            const lastTicks = ticks.slice(i - DYNAMIC_CONFIG.momentum, i);
            const allDown = lastTicks.every((v, idx) => idx === 0 || v < lastTicks[idx - 1]);
            const allUp = lastTicks.every((v, idx) => idx === 0 || v > lastTicks[idx - 1]);

            let signal = null;
            if (allDown && trend === 'UP') signal = 'MULTUP';
            if (allUp && trend === 'DOWN') signal = 'MULTDOWN';

            // --- FILTRO DE ACELERACIÓN ---
            if (signal && tickIntervals.length >= 4) {
                const last4 = tickIntervals.slice(-4);
                const isAccelerating = (last4[0] > last4[1] && last4[1] > last4[2] && last4[2] > last4[3]);
                const isExplosive = last4.every(t => t < 450);
                if (!isAccelerating && !isExplosive) signal = null;
            }

            if (signal) {
                inTrade = true;
                tradeType = signal;
                entryPrice = currentPrice;
                currentMaxProfit = 0;
                lastSlAssigned = -10;
                totalTrades++;
            }
        } else {
            let priceChangePct = (currentPrice - entryPrice) / entryPrice;
            if (tradeType === 'MULTDOWN') priceChangePct = -priceChangePct;
            const currentProfit = priceChangePct * DYNAMIC_CONFIG.multiplier * DYNAMIC_CONFIG.stake;
            if (currentProfit > currentMaxProfit) currentMaxProfit = currentProfit;

            // --- LÓGICA ESCALERA HÍBRIDA ---
            if (currentMaxProfit >= 0.30 && currentMaxProfit < 0.45 && lastSlAssigned < 0.15) lastSlAssigned = 0.15;
            else if (currentMaxProfit >= 0.45 && currentMaxProfit < 0.60 && lastSlAssigned < 0.30) lastSlAssigned = 0.30;
            else if (currentMaxProfit >= 0.60 && currentMaxProfit < 0.70 && lastSlAssigned < 0.50) lastSlAssigned = 0.50;
            else if (currentMaxProfit >= 0.70 && currentMaxProfit < 0.80 && lastSlAssigned < 0.60) lastSlAssigned = 0.60;
            else if (currentMaxProfit >= 0.80 && currentMaxProfit < 0.90 && lastSlAssigned < 0.70) lastSlAssigned = 0.70;
            else if (currentMaxProfit >= 0.90 && lastSlAssigned < 0.80) lastSlAssigned = 0.80;

            let exit = false;
            let finalProfit = 0;

            if (currentProfit >= DYNAMIC_CONFIG.takeProfit) {
                exit = true; finalProfit = DYNAMIC_CONFIG.takeProfit;
            } else if (lastSlAssigned > -10 && currentProfit <= lastSlAssigned) {
                exit = true; finalProfit = currentProfit;
            } else if (currentProfit <= -DYNAMIC_CONFIG.stopLoss) {
                exit = true; finalProfit = -DYNAMIC_CONFIG.stopLoss;
            }

            if (exit) {
                if (finalProfit > 0) wins++; else losses++;
                balance += finalProfit;
                inTrade = false;
                i += 50;
            }
        }
    }

    console.log(`\n====================================================`);
    console.log(`📊 REPORTE DE BACKTESTING: DYNAMIC ULTRA`);
    console.log(`Ticks Analizados: ${ticks.length}`);
    console.log(`====================================================`);
    console.log(`Operaciones: ${totalTrades}`);
    console.log(`Ganadas: ${wins} ✅`);
    console.log(`Perdidas: ${losses} ❌`);
    console.log(`Efectividad: ${((wins / (totalTrades || 1)) * 100).toFixed(1)}%`);
    console.log(`PnL Acumulado: $${balance.toFixed(2)}`);
    console.log(`====================================================\n`);
    process.exit(0);
}
