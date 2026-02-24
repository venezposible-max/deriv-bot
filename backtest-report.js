const WebSocket = require('ws');
const APP_ID = 1089;
const SYMBOL = 'R_100';

const DYNAMIC_CONFIG = {
    stake: 10,
    takeProfit: 0.60,
    multiplier: 40,
    momentum: 7,
    stopLoss: 0.60
};

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
let allPrices = [];
let allTimes = [];
const TARGET_TICKS = 30000;

ws.on('open', () => {
    fetchHistory();
});

function fetchHistory(beforeEpoch = null) {
    const request = {
        ticks_history: SYMBOL,
        adjust_start_time: 1,
        count: 5000,
        end: beforeEpoch || 'latest',
        style: 'ticks'
    };
    console.log(`📡 Solicitando lote de 5000 ticks... (${allPrices.length}/${TARGET_TICKS})`);
    ws.send(JSON.stringify(request));
}

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.error) {
        console.error(`❌ API Error: ${msg.error.message}`);
        ws.close();
        return;
    }
    if (msg.msg_type === 'history') {
        allPrices = [...msg.history.prices, ...allPrices];
        allTimes = [...msg.history.times, ...allTimes];

        if (allPrices.length < TARGET_TICKS) {
            fetchHistory(msg.history.times[0]);
        } else {
            console.log(`📊 Historial Cargado: ${allPrices.length} ticks.`);
            runSimulation(allPrices, allTimes);
            ws.close();
        }
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

        // Simular intervalos de ticks
        const currentTickMs = currentTime * 1000;
        const interval = currentTickMs - lastTickUpdate;
        tickIntervals.push(interval > 0 ? interval : 500); // 500ms default
        if (tickIntervals.length > 20) tickIntervals.shift();
        lastTickUpdate = currentTickMs;

        if (!inTrade) {
            const lastTicks = ticks.slice(i - DYNAMIC_CONFIG.momentum, i);
            const allDown = lastTicks.every((v, idx) => idx === 0 || v < lastTicks[idx - 1]);
            const allUp = lastTicks.every((v, idx) => idx === 0 || v > lastTicks[idx - 1]);

            let signal = null;
            if (allDown) signal = 'MULTUP';
            if (allUp) signal = 'MULTDOWN';

            // --- SOLO FILTRO DE VELOCIDAD (HFT MODE) ---
            if (signal) {
                if (tickIntervals.length >= 4) {
                    const last4 = tickIntervals.slice(-4);
                    // IMPORTANTE: En historial V100, los ticks suelen venir cada 2s (2000ms)
                    // Para que el backtest funcione, detectamos "velocidad" si es <= 2100ms
                    const isAccelerating = (last4[0] > last4[1] && last4[1] > last4[2] && last4[2] > last4[3]);
                    const isExplosive = last4.every(t => t <= 2100);

                    if (!isAccelerating && !isExplosive) {
                        signal = null;
                    }
                } else {
                    signal = null; // No hay suficientes datos de velocidad
                }
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

            // Escalera Híbrida
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
    console.log(`📊 BACKTEST: SOLO FILTRO DE VELOCIDAD (HFT)`);
    console.log(`Símbolo: ${SYMBOL} | Periodo: ~24 Horas`);
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
