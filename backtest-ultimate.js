const WebSocket = require('ws');
const APP_ID = 1089;
const SYMBOL = 'R_100';

const CONFIG = {
    stake: 20,
    multiplier: 100,
    stopLoss: 3.0,
    takeProfit: 10.0,
    momentum: 7,
    smaPeriod: 50,
    rsiPeriod: 14,
    atrMultiplier: 1.5
};

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
let allPrices = [];
let allTimes = [];
const TARGET_TICKS = 45000; // ~12-15 horas para un backtest sólido

ws.on('open', () => {
    console.log("📡 Iniciando Backtest DEFINITIVO: HÍBRIDO + TRAILING + ALPHA...");
    fetchHistory();
});

function fetchHistory(beforeEpoch = null) {
    ws.send(JSON.stringify({
        ticks_history: SYMBOL,
        adjust_start_time: 1,
        count: 5000,
        end: beforeEpoch || 'latest',
        style: 'ticks'
    }));
}

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.msg_type === 'history') {
        allPrices = [...msg.history.prices, ...allPrices];
        allTimes = [...msg.history.times, ...allTimes];
        if (allPrices.length < TARGET_TICKS) {
            process.stdout.write(".");
            fetchHistory(msg.history.times[0]);
        } else {
            console.log(`\n✅ Historial Cargado: ${allPrices.length} ticks.`);
            runUltimateSim(allPrices);
            ws.close();
        }
    }
});

function calculateSMA(data, period, endIdx) {
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
    let avgGain = gains / period;
    let avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    let rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}

function runUltimateSim(prices) {
    let balance = 0, wins = 0, losses = 0, totalTrades = 0;
    let inTrade = false, entryPrice = 0, tradeType = null, currentMaxProfit = 0, lastSlAssigned = -100;

    // Calcular ATR simplificado
    let candleRanges = [];
    for (let i = 60; i < prices.length; i += 60) {
        const slice = prices.slice(i - 60, i);
        candleRanges.push(Math.max(...slice) - Math.min(...slice));
    }

    console.log(`\n🚀 SIMULACIÓN ESTRATEGIA DEFINITIVA (V100 | 12H+)\n`);

    for (let i = 500; i < prices.length - 100; i++) {
        const currentPrice = prices[i];

        if (!inTrade) {
            // 🧠 CEREBRO HÍBRIDO
            const lastTicks = prices.slice(i - CONFIG.momentum, i);
            const allDown = lastTicks.every((v, idx) => idx === 0 || v < lastTicks[idx - 1]);
            const allUp = lastTicks.every((v, idx) => idx === 0 || v > lastTicks[idx - 1]);

            if (allUp || allDown) {
                const sma = calculateSMA(prices, CONFIG.smaPeriod, i);
                const rsi = calculateRSI(prices, CONFIG.rsiPeriod, i);

                if (sma && rsi) {
                    const distPct = Math.abs(currentPrice - sma) / sma * 100;

                    // Solo Sniper Híbrido Filtrado
                    if (distPct < 0.12 && rsi >= 35 && rsi <= 65) {
                        const candleIdx = Math.floor(i / 60);
                        const recentRanges = candleRanges.slice(Math.max(0, candleIdx - 14), candleIdx);
                        const avgAtr = recentRanges.reduce((a, b) => a + b, 0) / (recentRanges.length || 1);
                        const currentRange = Math.max(...prices.slice(i - 60, i)) - Math.min(...prices.slice(i - 60, i));

                        if (currentRange >= avgAtr * CONFIG.atrMultiplier) {
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
            // GESTIÓN DE TRADE CON TRAILING PRO + ALPHA
            let priceChangePct = (currentPrice - entryPrice) / entryPrice;
            if (tradeType === 'MULTDOWN') priceChangePct = -priceChangePct;
            const currentProfit = priceChangePct * CONFIG.multiplier * CONFIG.stake;
            if (currentProfit > currentMaxProfit) currentMaxProfit = currentProfit;

            // 🛡️ TRAILING PRO ACTIVO
            if (currentMaxProfit >= 9.00 && lastSlAssigned < 8.00) lastSlAssigned = 8.00;
            else if (currentMaxProfit >= 6.00 && lastSlAssigned < 4.50) lastSlAssigned = 4.50;
            else if (currentMaxProfit >= 4.00 && lastSlAssigned < 2.50) lastSlAssigned = 2.50;
            else if (currentMaxProfit >= 2.50 && lastSlAssigned < 1.00) lastSlAssigned = 1.00;
            else if (currentMaxProfit >= 1.00 && lastSlAssigned < 0.20) lastSlAssigned = 0.20;

            let exit = false, finalProfit = 0;
            if (currentProfit >= CONFIG.takeProfit) {
                exit = true; finalProfit = currentProfit;
            } else if (lastSlAssigned > -99 && currentProfit <= lastSlAssigned) {
                exit = true; finalProfit = currentProfit;
            } else if (currentProfit <= -CONFIG.stopLoss) {
                // ⚔️ MODO ALPHA REACCIONANDO
                finalProfit = -CONFIG.stopLoss;
                balance += finalProfit;
                losses++;

                // GIRO (STOP & REVERSE)
                tradeType = (tradeType === 'MULTUP') ? 'MULTDOWN' : 'MULTUP';
                entryPrice = currentPrice;
                currentMaxProfit = 0;
                lastSlAssigned = -100;
                totalTrades++;
                continue;
            }

            if (exit) {
                if (finalProfit > 0) wins++; else losses++;
                balance += finalProfit;
                inTrade = false;
                i += 30; // Cooldown
            }
        }
    }

    console.log(`====================================================`);
    console.log(`📊 REPORTE DEFINITIVO: HÍBRIDO + TRAILING + ALPHA`);
    console.log(`====================================================`);
    console.log(`Operaciones Totales: ${totalTrades}`);
    console.log(`Ganadas: ${wins} ✅ | Perdidas: ${losses} ❌`);
    console.log(`Efectividad: ${((wins / (wins + losses)) * 100).toFixed(1)}%`);
    console.log(`PnL Acumulado: $${balance.toFixed(2)} 💰`);
    console.log(`Rendimiento esperado: +$${(balance / 2).toFixed(2)} por cada 6 horas`);
    console.log(`====================================================\n`);
}
