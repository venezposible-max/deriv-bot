const WebSocket = require('ws');
const APP_ID = 1089;
const SYMBOL = 'R_100';

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
let allTicks = [];
const TICKS_TO_FETCH = 6500; // ~1.5 horas

// CONFIGURACIÓN CON BREAK-EVEN DINÁMICO
const CONFIG = {
    stake: 20,
    takeProfit: 3.00,
    stopLoss: 1.80,     // Realidad del retraso
    multiplier: 40,
    smaPeriod: 50,
    smaLongPeriod: 200,
    rsiPeriod: 14,
    rsiLow: 45,
    rsiHigh: 55,
    momentum: 5,
    distLimit: 0.08,
    beTrigger: 0.50,    // 🎯 Disparador: Al llegar a $0.50 de profit...
    beValue: 0.00       // 🛡️ Acción: Mover SL a $0.00 (Break-Even)
};

ws.on('open', () => {
    console.log(`📥 Descargando DATA TICKS para Simulación BREAK-EVEN (Últimos 90 min)...`);
    fetchTicks();
});

function fetchTicks(beforeEpoch = 'latest') {
    ws.send(JSON.stringify({
        ticks_history: SYMBOL,
        end: beforeEpoch || 'latest',
        count: 5000,
        style: 'ticks'
    }));
}

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.msg_type === 'history') {
        allTicks = [...(msg.history.prices || []), ...allTicks];
        if (allTicks.length < TICKS_TO_FETCH) {
            process.stdout.write('.');
            fetchTicks(msg.history.times[0]);
        } else {
            console.log(`\n✅ DATA CARGADA. Iniciando Simulación Estratégica...`);
            runSimulation();
            ws.close();
        }
    }
});

function calculateSMA(prices, period) {
    if (prices.length < period) return null;
    let sum = 0;
    for (let i = prices.length - period; i < prices.length; i++) sum += prices[i];
    return sum / period;
}

function calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) return 50;
    let gains = 0, losses = 0;
    for (let i = prices.length - period; i < prices.length; i++) {
        let diff = prices[i] - prices[i - 1];
        if (diff >= 0) gains += diff; else losses -= diff;
    }
    let rs = (gains / period) / ((losses / period) || 1);
    return 100 - (100 / (1 + rs));
}

function runSimulation() {
    let balance = 0, wins = 0, losses = 0, trades = 0;
    let inTrade = false, entryPrice = 0, tradeType = null, maxProfit = 0, currentSl = -100;

    const simulationTicks = allTicks.slice(-5400); // ~90 minutos

    console.log(`\n📊 SIMULANDO ÚLTIMA HORA Y MEDIA CON BREAK-EVEN A $0.50`);
    console.log(`Nº | TIPO | RESULTADO | PnL | BALANCE ACUM.`);
    console.log(`----------------------------------------------------`);

    for (let i = 250; i < simulationTicks.length; i++) {
        const quote = simulationTicks[i];

        if (!inTrade) {
            const last5 = simulationTicks.slice(i - CONFIG.momentum, i);
            const allUp = last5.every((v, j) => j === 0 || v > last5[j - 1]);
            const allDown = last5.every((v, j) => j === 0 || v < last5[j - 1]);

            const sma50 = calculateSMA(simulationTicks.slice(0, i), CONFIG.smaPeriod);
            const sma200 = calculateSMA(simulationTicks.slice(0, i), CONFIG.smaLongPeriod);
            const rsi = calculateRSI(simulationTicks.slice(0, i), 14);

            if (sma50 && sma200 && rsi) {
                const distPct = Math.abs(quote - sma50) / sma50 * 100;
                if (distPct < CONFIG.distLimit) {
                    if (allUp && quote > sma200 && rsi > CONFIG.rsiLow) {
                        inTrade = true; tradeType = 'UP'; entryPrice = quote; maxProfit = 0; currentSl = -CONFIG.stopLoss; trades++;
                    } else if (allDown && quote < sma200 && rsi < CONFIG.rsiHigh) {
                        inTrade = true; tradeType = 'DOWN'; entryPrice = quote; maxProfit = 0; currentSl = -CONFIG.stopLoss; trades++;
                    }
                }
            }
        } else {
            let diff = (quote - entryPrice) / entryPrice;
            if (tradeType === 'DOWN') diff = -diff;
            let prof = diff * CONFIG.multiplier * CONFIG.stake;
            if (prof > maxProfit) maxProfit = prof;

            // --- LÓGICA BREAK-EVEN ---
            if (maxProfit >= CONFIG.beTrigger && currentSl < CONFIG.beValue) {
                currentSl = CONFIG.beValue; // Movemos SL a $0.00
            }

            let closed = false;
            let pnl = 0;
            let resultTxt = "";

            if (prof <= currentSl) {
                pnl = currentSl; resultTxt = (pnl === 0) ? "🛡️ B-EVEN" : "❌ LOSS"; closed = true;
            } else if (prof >= CONFIG.takeProfit) {
                pnl = CONFIG.takeProfit; resultTxt = "✅ TARGET"; closed = true;
            }

            if (closed) {
                balance += pnl;
                if (pnl > 0) wins++; else losses++;
                inTrade = false;
                console.log(`${trades.toString().padStart(3)} | ${tradeType.padEnd(4)} | ${resultTxt.padEnd(8)} | $${pnl.toFixed(2).padStart(6)} | $${balance.toFixed(2).padStart(8)}`);
            }
        }
    }

    console.log(`----------------------------------------------------`);
    console.log(`TOTAL TRADES: ${trades}`);
    console.log(`PNL FINAL ESTIMADO: $${balance.toFixed(2)}`);
    console.log("====================================================");
}
