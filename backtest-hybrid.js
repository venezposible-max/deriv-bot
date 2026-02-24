const WebSocket = require('ws');
const APP_ID = 1089;
const SYMBOL = 'R_100';

const CONFIG = {
    stake: 20,
    takeProfit: 10.0,
    multiplier: 40,
    momentum: 5,
    stopLoss: 3.0,
    smaPeriod: 50,
    rsiPeriod: 14
};

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
let allPrices = [];
let allTimes = [];
const TARGET_TICKS = 60000; // ~34 horas de V100

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
    let gains = 0;
    let losses = 0;
    for (let i = prices.length - period; i < prices.length; i++) {
        let diff = prices[i] - prices[i - 1];
        if (diff >= 0) gains += diff; else losses -= diff;
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    let rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
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
    let lastSlAssigned = -100;
    let activeMode = null; // 'SNIPER' o 'DYNAMIC'

    console.log(`📊 Iniciando Simulación Híbrida (Distancia Media + RSI)...`);

    for (let i = 100; i < ticks.length; i++) {
        const currentPrice = ticks[i];
        const lastTicks = ticks.slice(i - CONFIG.momentum, i);
        const allDown = lastTicks.every((v, idx) => idx === 0 || v < lastTicks[idx - 1]);
        const allUp = lastTicks.every((v, idx) => idx === 0 || v > lastTicks[idx - 1]);

        if (!inTrade) {
            let signal = null;
            let decisionMode = null;

            if (allUp || allDown) {
                const sma = calculateSMA(ticks.slice(0, i), CONFIG.smaPeriod);
                const rsi = calculateRSI(ticks.slice(0, i), CONFIG.rsiPeriod);

                if (sma && rsi) {
                    const distPct = Math.abs(currentPrice - sma) / sma * 100;

                    // --- LÓGICA HÍBRIDA ---

                    // 1. SNIPER (Continuación de Tendencia)
                    // Cerca de la media (distancia < 0.10%) y RSI medio (40-60)
                    if (distPct < 0.10 && rsi >= 40 && rsi <= 60) {
                        signal = allUp ? 'MULTUP' : 'MULTDOWN';
                        decisionMode = 'SNIPER';
                    }

                    // 2. DINÁMICO (Rebote por Agotamiento)
                    // Lejos de la media (distancia > 0.20%) y RSI extremo (<25 o >75)
                    else if (distPct > 0.20) {
                        if (allUp && rsi > 75) {
                            signal = 'MULTDOWN'; // Rebote hacia abajo
                            decisionMode = 'DYNAMIC';
                        } else if (allDown && rsi < 25) {
                            signal = 'MULTUP'; // Rebote hacia arriba
                            decisionMode = 'DYNAMIC';
                        }
                    }
                }
            }

            if (signal) {
                inTrade = true;
                tradeType = signal;
                activeMode = decisionMode;
                entryPrice = currentPrice;
                currentMaxProfit = 0;
                lastSlAssigned = -100;
                totalTrades++;
                // console.log(`[ENTRY] Mode: ${activeMode} | Type: ${tradeType} | Price: ${entryPrice} | RSI: ${calculateRSI(ticks.slice(0, i)).toFixed(1)}`);
            }
        } else {
            // Gestión de Trade
            let priceChangePct = (currentPrice - entryPrice) / entryPrice;
            if (tradeType === 'MULTDOWN') priceChangePct = -priceChangePct;

            const currentProfit = priceChangePct * CONFIG.multiplier * CONFIG.stake;
            if (currentProfit > currentMaxProfit) currentMaxProfit = currentProfit;

            // Trailing Stop Agresivo Extendido (Para TP de $10)
            if (currentMaxProfit >= 9.00 && lastSlAssigned < 8.50) lastSlAssigned = 8.50;
            else if (currentMaxProfit >= 7.00 && lastSlAssigned < 6.00) lastSlAssigned = 6.00;
            else if (currentMaxProfit >= 5.00 && lastSlAssigned < 4.00) lastSlAssigned = 4.00;
            else if (currentMaxProfit >= 3.00 && lastSlAssigned < 2.50) lastSlAssigned = 2.50;
            else if (currentMaxProfit >= 2.00 && lastSlAssigned < 1.50) lastSlAssigned = 1.50;
            else if (currentMaxProfit >= 1.00 && lastSlAssigned < 0.70) lastSlAssigned = 0.70;
            else if (currentMaxProfit >= 0.60 && lastSlAssigned < 0.40) lastSlAssigned = 0.40;
            else if (currentMaxProfit >= 0.40 && lastSlAssigned < 0.30) lastSlAssigned = 0.30;

            let exit = false;
            let finalProfit = 0;

            // Si es modo Dinámico, buscamos salir rápido (TP corto)
            // Si es Sniper, usamos el de la configuración
            const tpTarget = (activeMode === 'DYNAMIC') ? 0.80 : CONFIG.takeProfit;

            if (currentProfit >= tpTarget) {
                exit = true; finalProfit = currentProfit;
            } else if (lastSlAssigned > -99 && currentProfit <= lastSlAssigned) {
                exit = true; finalProfit = currentProfit;
            } else if (currentProfit <= -CONFIG.stopLoss) {
                exit = true; finalProfit = -CONFIG.stopLoss;
            }

            if (exit) {
                if (finalProfit > 0) wins++; else losses++;
                balance += finalProfit;
                inTrade = false;
                i += 30; // Cooldown simulado
            }
        }
    }

    console.log(`\n====================================================`);
    console.log(`📊 REPORTE HÍBRIDO: SNIPER + DYNAMIC`);
    console.log(`Lógica: Distancia Media + RSI Exhaustion`);
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
