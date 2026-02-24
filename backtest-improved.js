const WebSocket = require('ws');
const APP_ID = 1089;
const SYMBOL = 'R_100';

const CONFIG = {
    stake: 20,
    takeProfit: 10.0,
    multiplier: 40,
    momentum: 7,
    stopLoss: 3.0,
    smaPeriod: 50,
    rsiPeriod: 14
};

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
let allPrices = [];
let allTimes = [];
const TARGET_TICKS = 50000;

ws.on('open', () => { fetchHistory(); });

function fetchHistory(beforeEpoch = null) {
    const request = {
        ticks_history: SYMBOL,
        adjust_start_time: 1,
        count: 5000,
        end: beforeEpoch || 'latest',
        style: 'ticks'
    };
    ws.send(JSON.stringify(request));
}

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.msg_type === 'history') {
        allPrices = [...msg.history.prices, ...allPrices];
        allTimes = [...msg.history.times, ...allTimes];
        if (allPrices.length < TARGET_TICKS) {
            process.stdout.write('.');
            fetchHistory(msg.history.times[0]);
        } else {
            console.log(`\n📊 Historial Cargado: ${allPrices.length} ticks.`);
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

function calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) return 50;
    let gains = 0, losses = 0;
    for (let i = prices.length - period; i < prices.length; i++) {
        let diff = prices[i] - prices[i - 1];
        if (diff >= 0) gains += diff; else losses -= diff;
    }
    let rs = (gains / period) / (losses / period);
    return 100 - (100 / (1 + rs));
}

function runSimulation(ticks, times) {
    let balance = 0, totalTrades = 0, wins = 0, losses = 0;
    let inTrade = false, entryPrice = 0, tradeType = null, currentMaxProfit = 0, lastSlAssigned = -100;

    console.log(`🚀 SIMULACIÓN: CRECIMIENTO AGRESIVO (V2)...`);

    // Pre-calcular ATR real
    let candleRanges = [];
    for (let i = 60; i < ticks.length; i += 60) {
        const slice = ticks.slice(i - 60, i);
        candleRanges.push(Math.max(...slice) - Math.min(...slice));
    }

    const startIdx = 2000; // Suficiente para tener ATR promedio
    for (let i = startIdx; i < ticks.length; i++) {
        const currentPrice = ticks[i];

        if (!inTrade) {
            const lastTicks = ticks.slice(i - CONFIG.momentum, i);
            const allDown = lastTicks.every((v, idx) => idx === 0 || v < lastTicks[idx - 1]);
            const allUp = lastTicks.every((v, idx) => idx === 0 || v > lastTicks[idx - 1]);

            if (allUp || allDown) {
                const sma = calculateSMA(ticks.slice(0, i), CONFIG.smaPeriod);
                const rsi = calculateRSI(ticks.slice(0, i), CONFIG.rsiPeriod);

                if (sma && rsi) {
                    const distPct = Math.abs(currentPrice - sma) / sma * 100;
                    if (distPct < 0.12 && rsi >= 35 && rsi <= 65) {
                        // ATR Filter
                        const candleIdx = Math.floor(i / 60);
                        const recentRanges = candleRanges.slice(Math.max(0, candleIdx - 14), candleIdx);
                        const avgAtr = recentRanges.reduce((a, b) => a + b, 0) / recentRanges.length;
                        const currentRange = Math.max(...ticks.slice(i - 60, i)) - Math.min(...ticks.slice(i - 60, i));

                        if (currentRange >= avgAtr * 1.3) { // Bajamos a 1.3 para ver volumen
                            inTrade = true;
                            tradeType = allUp ? 'MULTUP' : 'MULTDOWN';
                            entryPrice = currentPrice;
                            currentMaxProfit = 0;
                            lastSlAssigned = -100;
                            totalTrades++;
                        }
                    }
                }
            }
        } else {
            let priceChangePct = (currentPrice - entryPrice) / entryPrice;
            if (tradeType === 'MULTDOWN') priceChangePct = -priceChangePct;
            const currentProfit = priceChangePct * CONFIG.multiplier * CONFIG.stake;
            if (currentProfit > currentMaxProfit) currentMaxProfit = currentProfit;

            // --- TRAILING VALIENTE (Para Facturar $$$) ---
            if (currentMaxProfit >= 9.00 && lastSlAssigned < 8.00) lastSlAssigned = 8.00;
            else if (currentMaxProfit >= 6.00 && lastSlAssigned < 4.00) lastSlAssigned = 4.00;
            else if (currentMaxProfit >= 4.00 && lastSlAssigned < 2.00) lastSlAssigned = 2.00;
            else if (currentMaxProfit >= 2.00 && lastSlAssigned < 0.50) lastSlAssigned = 0.50; // Asegura solo un poco
            else if (currentMaxProfit >= 1.00 && lastSlAssigned < 0.10) lastSlAssigned = 0.10;

            let exit = false, finalProfit = 0;
            if (currentProfit >= CONFIG.takeProfit) { exit = true; finalProfit = currentProfit; }
            else if (lastSlAssigned > -99 && currentProfit <= lastSlAssigned) { exit = true; finalProfit = currentProfit; }
            else if (currentProfit <= -CONFIG.stopLoss) { exit = true; finalProfit = -CONFIG.stopLoss; }

            if (exit) {
                if (finalProfit > 0) wins++; else losses++;
                balance += finalProfit;
                inTrade = false;
                i += 30;
            }
        }
    }

    console.log(`\n====================================================`);
    console.log(`📊 REPORTE HIGH-YIELD (V100 - 24H)`);
    console.log(`====================================================`);
    console.log(`Operaciones: ${totalTrades}`);
    console.log(`Ganadas: ${wins} ✅ | Perdidas: ${losses} ❌`);
    console.log(`PnL Acumulado: $${balance.toFixed(2)}`);
    if (totalTrades > 0) console.log(`Ganancia Promedio por Trade: $${(balance / totalTrades).toFixed(2)}`);
    console.log(`====================================================\n`);
}
