const WebSocket = require('ws');
const APP_ID = 1089;
const SYMBOL = 'R_100';

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
let allTicks = [];
const TICKS_TO_FETCH = 10000; // Suficiente para ver tendencias

const CONFIG = {
    stake: 20,
    takeProfit: 3.00,
    stopLoss: 1.80,     // 🚨 AJUSTE DE REALIDAD: El SL real con retraso es de ~$1.80
    multiplier: 40,
    smaPeriod: 50,
    smaLongPeriod: 200,
    rsiPeriod: 14,
    rsiLow: 45,
    rsiHigh: 55,
    momentum: 5,
    distLimit: 0.08,    // 🎯 Filtro de precisión
    trailStart: 0.50,
    trailDist: 0.50
};

ws.on('open', () => {
    console.log(`📥 Descargando DATA TICKS para BACKTEST DE REALIDAD CRUDA (Última Hora)...`);
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
        const chunk = msg.history.prices || [];
        const times = msg.history.times || [];
        allTicks = [...chunk, ...allTicks];
        if (allTicks.length < TICKS_TO_FETCH && chunk.length > 0) {
            process.stdout.write('.');
            fetchTicks(times[0]);
        } else {
            console.log(`\n✅ DATA CARGADA. Iniciando simulador pesimista...`);
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
    let inTrade = false, entryPrice = 0, tradeType = null, maxProfit = 0, lastSl = -100;

    // Solo analizamos los últimos 50 munitos para tratar de ver esos 5 trades
    const simulationTicks = allTicks.slice(-3000);

    console.log(`\n====================================================`);
    console.log(`📉 LOG DE REALIDAD (SL $1.80 | LATENCIA SIMULADA)`);
    console.log(`====================================================`);
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
                    let trigger = false;
                    if (allUp && quote > sma200 && rsi > CONFIG.rsiLow) {
                        inTrade = true; tradeType = 'UP'; trigger = true;
                    } else if (allDown && quote < sma200 && rsi < CONFIG.rsiHigh) {
                        inTrade = true; tradeType = 'DOWN'; trigger = true;
                    }

                    if (trigger) {
                        entryPrice = quote; maxProfit = 0; lastSl = -100; trades++;
                    }
                }
            }
        } else {
            let diff = (quote - entryPrice) / entryPrice;
            if (tradeType === 'DOWN') diff = -diff;
            let prof = diff * CONFIG.multiplier * CONFIG.stake;
            if (prof > maxProfit) maxProfit = prof;

            // Simulación de Trailing con "mordida" mayor para realismo
            if (maxProfit >= CONFIG.trailStart) {
                let floor = (Math.floor(maxProfit / 0.5) * 0.5) - 0.55; // 0.55 para simular que no cerramos exacto en 0.50
                if (floor > lastSl) lastSl = floor;
            }

            let closed = false;
            let pnl = 0;
            let resultTxt = "";

            if (prof <= -1.40) { // Disparo de SL a los 1.40 para que cierre en 1.71/1.80 por retraso
                pnl = -CONFIG.stopLoss; resultTxt = "❌ SL-LATE"; closed = true;
            } else if (prof >= CONFIG.takeProfit) {
                pnl = CONFIG.takeProfit; resultTxt = "✅ TARGET"; closed = true;
            } else if (lastSl > -99 && prof <= lastSl) {
                pnl = lastSl; resultTxt = "🛡️ TRAIL"; closed = true;
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
    console.log(`====================================================`);
}
