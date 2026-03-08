const WebSocket = require('ws');
const APP_ID = 1089;
const SYMBOL = 'R_100';

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
let allTicks = [];
const TOTAL_TICKS_NEEDED = 40000; // ~12 horas de mercado real en V100

const CONFIG = {
    stake: 20,
    takeProfit: 3.0,
    multiplier: 40,
    momentum: 5,
    stopLoss: 1.5,
    trailStart: 0.5,
    trailDist: 0.5,
    smaLongPeriod: 200
};

ws.on('open', () => {
    console.log(`📥 Descargando DATA TICKS para REPORTE DETALLADO (12H)...`);
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
        if (allTicks.length < TOTAL_TICKS_NEEDED && chunk.length > 0) {
            process.stdout.write('.');
            fetchTicks(times[0]);
        } else {
            console.log(`\n✅ DATA CARGADA. Procesando trades paso a paso...`);
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
    let balance = 0, wins = 0, losses = 0, totalTrades = 0;
    let inTrade = false, entryPrice = 0, tradeType = null, maxProfit = 0, lastSl = -100;

    console.log("\n====================================================");
    console.log("📝 LOG DETALLADO DE OPERACIONES (ÚLTIMAS 12 HORAS)");
    console.log("====================================================");
    console.log("Nº | TIPO | RESULTADO | PnL | BALANCE ACUM.");
    console.log("----------------------------------------------------");

    for (let i = 250; i < allTicks.length; i++) {
        const quote = allTicks[i];

        if (!inTrade) {
            const last5 = allTicks.slice(i - CONFIG.momentum, i);
            const allUp = last5.every((v, idx) => idx === 0 || v > last5[idx - 1]);
            const allDown = last5.every((v, idx) => idx === 0 || v < last5[idx - 1]);
            const sma200 = calculateSMA(allTicks.slice(0, i), CONFIG.smaLongPeriod);
            const rsi = calculateRSI(allTicks.slice(0, i), 14);

            if (sma200 && rsi) {
                if (allUp && quote > sma200 && rsi > 45) {
                    inTrade = true; tradeType = 'UP'; entryPrice = quote; maxProfit = 0; lastSl = -100;
                } else if (allDown && quote < sma200 && rsi < 55) {
                    inTrade = true; tradeType = 'DOWN'; entryPrice = quote; maxProfit = 0; lastSl = -100;
                }
            }
        } else {
            let diff = (quote - entryPrice) / entryPrice;
            if (tradeType === 'DOWN') diff = -diff;
            let prof = diff * CONFIG.multiplier * CONFIG.stake;
            if (prof > maxProfit) maxProfit = prof;

            if (maxProfit >= CONFIG.trailStart) {
                let floor = (Math.floor(maxProfit / 0.5) * 0.5) - CONFIG.trailDist;
                if (floor > lastSl) lastSl = floor;
            }

            let closed = false;
            let pnl = 0;
            let resultType = "";

            if (prof <= -CONFIG.stopLoss) {
                pnl = -CONFIG.stopLoss; resultType = "❌ LOSS"; closed = true;
            } else if (prof >= CONFIG.takeProfit) {
                pnl = CONFIG.takeProfit; resultType = "✅ TARGET"; closed = true;
            } else if (lastSl > -99 && prof <= lastSl) {
                pnl = lastSl; resultType = pnl > 0 ? "🛡️ TRAIL-S" : "🛡️ TRAIL-L"; closed = true;
            }

            if (closed) {
                totalTrades++;
                balance += pnl;
                if (pnl > 0) wins++; else losses++;
                inTrade = false;

                // Imprimir solo una muestra para no saturar la terminal, o los más relevantes
                if (totalTrades <= 20 || totalTrades % 30 === 0 || totalTrades > 600) {
                    console.log(`${totalTrades.toString().padStart(3)} | ${tradeType} | ${resultType.padEnd(8)} | $${pnl.toFixed(2).padStart(5)} | $${balance.toFixed(2).padStart(7)}`);
                }
            }
        }
    }

    console.log("----------------------------------------------------");
    console.log(`TOTAL TRADES: ${totalTrades}`);
    console.log(`GANADOS: ${wins} | PERDIDOS: ${losses}`);
    console.log(`PnL NETO FINAL: $${balance.toFixed(2)}`);
    console.log("====================================================");
}
