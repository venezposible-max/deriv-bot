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
const TARGET_TICKS = 10000; // Analizaremos unas 5-6 horas para ver el efecto

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
    let balance = 0;
    let totalTrades = 0;
    let wins = 0;
    let losses = 0;
    let inTrade = false;
    let entryPrice = 0;
    let tradeType = null;
    let currentMaxProfit = 0;
    let lastSlAssigned = -100;
    let activeMode = null;

    console.log(`📊 Iniciando Simulación: STOP & REVERSE (Híbrida)...`);

    for (let i = 100; i < ticks.length; i++) {
        const currentPrice = ticks[i];
        const lastTicks = ticks.slice(i - CONFIG.momentum, i);
        const allDown = lastTicks.every((v, idx) => idx === 0 || v < lastTicks[idx - 1]);
        const allUp = lastTicks.every((v, idx) => idx === 0 || v > lastTicks[idx - 1]);

        let signal = null;
        let decisionMode = null;

        if (allUp || allDown) {
            const sma = calculateSMA(ticks.slice(0, i), CONFIG.smaPeriod);
            const rsi = calculateRSI(ticks.slice(0, i), CONFIG.rsiPeriod);
            if (sma && rsi) {
                const distPct = Math.abs(currentPrice - sma) / sma * 100;
                if (distPct < 0.10 && rsi >= 40 && rsi <= 60) {
                    signal = allUp ? 'MULTUP' : 'MULTDOWN';
                    decisionMode = 'SNIPER';
                }
                else if (distPct > 0.20) {
                    if (allUp && rsi > 75) { signal = 'MULTDOWN'; decisionMode = 'DYNAMIC'; }
                    else if (allDown && rsi < 25) { signal = 'MULTUP'; decisionMode = 'DYNAMIC'; }
                }
            }
        }

        if (inTrade) {
            // Gestión de Trade Actual
            let priceChangePct = (currentPrice - entryPrice) / entryPrice;
            if (tradeType === 'MULTDOWN') priceChangePct = -priceChangePct;
            let currentProfit = priceChangePct * CONFIG.multiplier * CONFIG.stake;
            if (currentProfit > currentMaxProfit) currentMaxProfit = currentProfit;

            // Trailing Stop Agresivo
            if (currentMaxProfit >= 9.00 && lastSlAssigned < 8.50) lastSlAssigned = 8.50;
            else if (currentMaxProfit >= 5.00 && lastSlAssigned < 4.00) lastSlAssigned = 4.00;
            else if (currentMaxProfit >= 1.00 && lastSlAssigned < 0.70) lastSlAssigned = 0.70;
            else if (currentMaxProfit >= 0.40 && lastSlAssigned < 0.30) lastSlAssigned = 0.30;

            let exit = false;
            let finalProfit = 0;

            // --- LÓGICA STOP & REVERSE ---
            // Si hay una señal opuesta CLARA, cerramos y volteamos inmediatamente
            if (signal && signal !== tradeType) {
                exit = true;
                finalProfit = currentProfit;
                // console.log(`🔄 [REVERSE] Cerrando ${tradeType} ($${currentProfit.toFixed(2)}) y abriendo ${signal}`);
            }
            else if (currentProfit >= (activeMode === 'DYNAMIC' ? 0.80 : CONFIG.takeProfit)) {
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

                // Si fue un REVERSE, abrimos la nueva de inmediato
                if (signal && signal !== tradeType) {
                    inTrade = true;
                    tradeType = signal;
                    activeMode = decisionMode;
                    entryPrice = currentPrice;
                    currentMaxProfit = 0;
                    lastSlAssigned = -100;
                    totalTrades++;
                }
            }
        } else if (signal) {
            inTrade = true;
            tradeType = signal;
            activeMode = decisionMode;
            entryPrice = currentPrice;
            currentMaxProfit = 0;
            lastSlAssigned = -100;
            totalTrades++;
        }
    }

    console.log(`\n====================================================`);
    console.log(`📊 REPORTE FINAL: STOP & REVERSE (HÍBRIDO)`);
    console.log(`Stake: $${CONFIG.stake} | SL: $${CONFIG.stopLoss} | TP: $${CONFIG.takeProfit}`);
    console.log(`====================================================`);
    console.log(`Operaciones: ${totalTrades}`);
    console.log(`Ganadas: ${wins} ✅`);
    console.log(`Perdidas: ${losses} ❌`);
    console.log(`Efectividad: ${((wins / (totalTrades || 1)) * 100).toFixed(1)}%`);
    console.log(`PnL Acumulado: $${balance.toFixed(2)}`);
    console.log(`====================================================\n`);
    process.exit(0);
}
