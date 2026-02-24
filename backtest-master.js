const WebSocket = require('ws');
const APP_ID = 1089;
const SYMBOL_V100 = 'R_100';
const SYMBOL_V10_1S = '1HZ10V';

const CONFIG = {
    stake: 20,
    multiplier: 100,
    stopLoss: 3.0,
    takeProfit: 10.0,
    smaPeriod: 50,
    rsiPeriod: 14,
    momentum: 7
};

// Almacén de datos
let dataV100 = { prices: [], times: [] };
let dataV10S = { prices: [], times: [] };
const TARGET_TICKS = 90000; // ~25 horas

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

ws.on('open', () => {
    console.log("📡 Iniciando Descarga Maestras para Auditoría de Estrategias Ocultas...");
    fetchHistory(SYMBOL_V10_1S);
});

function fetchHistory(symbol, beforeEpoch = null) {
    ws.send(JSON.stringify({
        ticks_history: symbol,
        adjust_start_time: 1,
        count: 5000,
        end: beforeEpoch || 'latest',
        style: 'ticks'
    }));
}

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.msg_type === 'history') {
        const symbol = msg.echo_req.ticks_history;
        const prices = msg.history.prices;
        const times = msg.history.times;

        if (symbol === SYMBOL_V10_1S) {
            dataV10S.prices = [...prices, ...dataV10S.prices];
            dataV10S.times = [...times, ...dataV10S.times];
            if (dataV10S.prices.length < TARGET_TICKS) fetchHistory(SYMBOL_V10_1S, times[0]);
            else fetchHistory(SYMBOL_V100);
        } else {
            if (dataV100.prices.length === 0) console.log("✅ V10(1s) cargado. Cargando V100...");
            dataV100.prices = [...prices, ...dataV100.prices];
            dataV100.times = [...times, ...dataV100.times];
            if (dataV100.prices.length < TARGET_TICKS) fetchHistory(SYMBOL_V100, times[0]);
            else {
                console.log(`✅ Datos cargados: V100 (${dataV100.prices.length}) | V10_1S (${dataV10S.prices.length})`);
                runAllSimulations();
                ws.close();
            }
        }
    }
});

function calculateSMA(data, period, endIdx) {
    if (endIdx < period) return null;
    let sum = 0;
    for (let i = endIdx - period; i < endIdx; i++) sum += data[i];
    return sum / period;
}

function calculateRSI(prices, period, endIdx) {
    if (endIdx < period + 1) return 50;
    let gains = 0, losses = 0;
    for (let i = endIdx - period; i < endIdx; i++) {
        let diff = prices[i] - prices[i - 1];
        if (diff >= 0) gains += diff; else losses -= diff;
    }
    let rs = (gains / period) / (losses / period);
    return 100 - (100 / (1 + rs));
}

function runAllSimulations() {
    const modes = [
        { name: "BASE (High-Yield Actual)", useV10Radar: false, useGhostSweep: false, useStopReverse: false },
        { name: "ULTRA (Base + V10 Radar)", useV10Radar: true, useGhostSweep: false, useStopReverse: false },
        { name: "GHOST (Base + Liquidity sweep)", useV10Radar: false, useGhostSweep: true, useStopReverse: false },
        { name: "ALPHA (Base + Stop & Reverse)", useV10Radar: false, useGhostSweep: false, useStopReverse: true },
        { name: "MASTER COMBINED (Todo Junto)", useV10Radar: true, useGhostSweep: true, useStopReverse: true }
    ];

    console.log("\n🧪 COMPARTIENDO RESULTADOS DE COMPETENCIA DE ESTRATEGIAS (24H):\n");

    modes.forEach(mode => {
        const result = simulate(mode);
        console.log(`[${mode.name.padEnd(25)}] PnL: $${result.balance.toFixed(2).padStart(8)} | Efec: ${result.eff}% | Trades: ${result.trades}`);
    });
}

function simulate(mode) {
    let balance = 0, wins = 0, losses = 0, totalTrades = 0;
    let inTrade = false, entryPrice = 0, tradeType = null, currentMaxProfit = 0, lastSlAssigned = -100;

    const prices = dataV100.prices;
    const times = dataV100.times;

    for (let i = 500; i < prices.length - 100; i++) {
        const currentPrice = prices[i];

        if (!inTrade) {
            // Lógica Base Sniper
            const lastTicks = prices.slice(i - CONFIG.momentum, i);
            const allDown = lastTicks.every((v, idx) => idx === 0 || v < lastTicks[idx - 1]);
            const allUp = lastTicks.every((v, idx) => idx === 0 || v > lastTicks[idx - 1]);

            if (allUp || allDown) {
                const sma = calculateSMA(prices, CONFIG.smaPeriod, i);
                const rsi = calculateRSI(prices, CONFIG.rsiPeriod, i);

                if (sma && rsi) {
                    const distPct = Math.abs(currentPrice - sma) / sma * 100;

                    // Condición Base Sniper Híbrido
                    let canEnter = (distPct < 0.12 && rsi >= 35 && rsi <= 65);

                    // --- FILTRO OCULTO 1: V10 RADAR ---
                    if (canEnter && mode.useV10Radar) {
                        const v10Idx = dataV10S.times.findIndex(t => t >= times[i]);
                        if (v10Idx !== -1 && v10Idx > 5) {
                            const v10Slice = dataV10S.prices.slice(v10Idx - 5, v10Idx);
                            const v10Up = v10Slice.every((v, idx) => idx === 0 || v > v10Slice[idx - 1]);
                            const v10Down = v10Slice.every((v, idx) => idx === 0 || v < v10Slice[idx - 1]);
                            if (allUp && !v10Up) canEnter = false;
                            if (allDown && !v10Down) canEnter = false;
                        }
                    }

                    // --- FILTRO OCULTO 2: GHOST SWEEP ---
                    if (canEnter && mode.useGhostSweep) {
                        const recentWindow = prices.slice(i - 100, i);
                        const top = Math.max(...recentWindow);
                        const bot = Math.min(...recentWindow);
                        // Solo entra si venimos de un "falso quiebre" (rompimos máximo y volvimos a entrar)
                        if (allUp && currentPrice < top - 0.05) canEnter = true; // Simplificado
                        else if (allDown && currentPrice > bot + 0.05) canEnter = true;
                        else canEnter = false;
                    }

                    if (canEnter) {
                        inTrade = true;
                        tradeType = allUp ? 'MULTUP' : 'MULTDOWN';
                        entryPrice = currentPrice;
                        currentMaxProfit = 0;
                        lastSlAssigned = -100;
                        totalTrades++;
                    }
                }
            }
        } else {
            // Gestión de Trade
            let priceChangePct = (currentPrice - entryPrice) / entryPrice;
            if (tradeType === 'MULTDOWN') priceChangePct = -priceChangePct;
            const currentProfit = priceChangePct * CONFIG.multiplier * CONFIG.stake;
            if (currentProfit > currentMaxProfit) currentMaxProfit = currentProfit;

            // Trailing Valiente
            if (currentMaxProfit >= 9.00 && lastSlAssigned < 8.00) lastSlAssigned = 8.00;
            else if (currentMaxProfit >= 5.00 && lastSlAssigned < 3.00) lastSlAssigned = 3.00;
            else if (currentMaxProfit >= 2.50 && lastSlAssigned < 1.00) lastSlAssigned = 1.00;
            else if (currentMaxProfit >= 0.80 && lastSlAssigned < 0.10) lastSlAssigned = 0.10;

            let exit = false, finalProfit = 0;
            if (currentProfit >= CONFIG.takeProfit) { exit = true; finalProfit = currentProfit; }
            else if (lastSlAssigned > -99 && currentProfit <= lastSlAssigned) { exit = true; finalProfit = currentProfit; }
            else if (currentProfit <= -CONFIG.stopLoss) {
                exit = true;
                finalProfit = -CONFIG.stopLoss;

                // --- LOGICA OCULTA 3: STOP & REVERSE ---
                if (mode.useStopReverse) {
                    // Abrimos inmediatamente al revés
                    tradeType = (tradeType === 'MULTUP') ? 'MULTDOWN' : 'MULTUP';
                    entryPrice = currentPrice;
                    currentMaxProfit = 0;
                    lastSlAssigned = -100;
                    totalTrades++;
                    exit = false; // No salimos, mutamos el trade
                }
            }

            if (exit) {
                if (finalProfit > 0) wins++; else losses++;
                balance += finalProfit;
                inTrade = false;
                i += 30;
            }
        }
    }
    return { balance, trades: totalTrades, wins, eff: ((wins / (totalTrades || 1)) * 100).toFixed(1) };
}
