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
    rsiPeriod: 14
};

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
let allPrices = [];
const TARGET_TICKS = 10000; // Analizaremos unas 3-4 horas intensas

ws.on('open', () => {
    console.log("📡 Iniciando Corrida Detallada: MODO ALPHA (Stop & Reverse)...");
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
        if (allPrices.length < TARGET_TICKS) {
            fetchHistory(msg.history.times[0]);
        } else {
            runAlphaSim(allPrices);
            ws.close();
        }
    }
});

function calculateSMA(data, period, endIdx) {
    let sum = 0;
    for (let i = endIdx - period; i < endIdx; i++) sum += data[i];
    return sum / period;
}

function runAlphaSim(prices) {
    let balance = 0, wins = 0, losses = 0, totalTrades = 0;
    let inTrade = false, entryPrice = 0, tradeType = null, currentMaxProfit = 0, lastSlAssigned = -100;
    let isReverseTrade = false;

    console.log(`\n🚀 INICIO DE CORRIDA ALPHA (V100 | Stake $20)\n`);

    for (let i = 200; i < prices.length - 50; i++) {
        const currentPrice = prices[i];

        if (!inTrade) {
            const lastTicks = prices.slice(i - CONFIG.momentum, i);
            const allDown = lastTicks.every((v, idx) => idx === 0 || v < lastTicks[idx - 1]);
            const allUp = lastTicks.every((v, idx) => idx === 0 || v > lastTicks[idx - 1]);

            if (allUp || allDown) {
                const sma = calculateSMA(prices, CONFIG.smaPeriod, i);
                if (Math.abs(currentPrice - sma) / sma * 100 < 0.15) {
                    inTrade = true;
                    tradeType = allUp ? 'MULTUP' : 'MULTDOWN';
                    entryPrice = currentPrice;
                    currentMaxProfit = 0;
                    lastSlAssigned = -100;
                    isReverseTrade = false;
                    totalTrades++;
                    // console.log(`[ENTRY] ${tradeType} @ ${entryPrice.toFixed(2)}`);
                }
            }
        } else {
            let priceChangePct = (currentPrice - entryPrice) / entryPrice;
            if (tradeType === 'MULTDOWN') priceChangePct = -priceChangePct;
            const currentProfit = priceChangePct * CONFIG.multiplier * CONFIG.stake;
            if (currentProfit > currentMaxProfit) currentMaxProfit = currentProfit;

            // Trailing Stop
            if (currentMaxProfit >= 5.00 && lastSlAssigned < 3.00) lastSlAssigned = 3.00;
            else if (currentMaxProfit >= 2.50 && lastSlAssigned < 1.00) lastSlAssigned = 1.00;

            let exit = false, finalProfit = 0;
            if (currentProfit >= CONFIG.takeProfit) {
                exit = true; finalProfit = currentProfit;
                console.log(`✅ TP ALCANZADO: +$${finalProfit.toFixed(2)}`);
            } else if (lastSlAssigned > -99 && currentProfit <= lastSlAssigned) {
                exit = true; finalProfit = currentProfit;
                console.log(`🔒 SEGURO COBRADO: +$${finalProfit.toFixed(2)}`);
            } else if (currentProfit <= -CONFIG.stopLoss) {
                // AQUÍ OCURRE LA MAGIA ALPHA
                finalProfit = -CONFIG.stopLoss;
                balance += finalProfit;
                losses++;
                console.log(`❌ SL TOCADO: -$${Math.abs(finalProfit).toFixed(2)} | 🔄 GIRANDO POSICIÓN...`);

                // GIRO INMEDIATO (STOP & REVERSE)
                tradeType = (tradeType === 'MULTUP') ? 'MULTDOWN' : 'MULTUP';
                entryPrice = currentPrice;
                currentMaxProfit = 0;
                lastSlAssigned = -100;
                isReverseTrade = true;
                totalTrades++;
                continue; // Seguimos en el mismo ciclo para el nuevo trade
            }

            if (exit) {
                if (finalProfit > 0) wins++; else losses++;
                balance += finalProfit;
                inTrade = false;
                i += 30; // Cooldown
            }
        }
    }

    console.log(`\n====================================================`);
    console.log(`📊 RESUMEN FINAL CORRIDA ALPHA`);
    console.log(`====================================================`);
    console.log(`Operaciones Totales: ${totalTrades}`);
    console.log(`Resultados: ${wins} ✅ | ${losses} ❌`);
    console.log(`PnL Acumulado: $${balance.toFixed(2)} 💰`);
    console.log(`Efectividad: ${((wins / (wins + losses)) * 100).toFixed(1)}%`);
    console.log(`====================================================\n`);
}
