const WebSocket = require('ws');
const APP_ID = 1089;
const SYMBOL = 'R_100';

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
let allTicks = [];

// FECHA OBJETIVO: 2 de Febrero de 2026
// Queremos las 24 horas del día 2. O sea, desde 2026-02-02 00:00:00 hasta 2026-02-03 00:00:00 UTC
const startEpoch = Math.floor(new Date('2026-02-02T00:00:00Z').getTime() / 1000);
const endEpoch = Math.floor(new Date('2026-02-03T00:00:00Z').getTime() / 1000);

// Necesitaremos unos 200 ticks extra al principio para el SMA200
const fetchStartEpoch = endEpoch;
const TOTAL_DURATION_SECONDS = 86400 + (3600 * 2); // 24h + 2h de colchón

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
    console.log(`📥 Descargando DATA TICKS para el 2 DE FEBRERO de 2026 (~80k-90k ticks)...`);
    fetchTicks(fetchStartEpoch);
});

function fetchTicks(beforeEpoch) {
    ws.send(JSON.stringify({
        ticks_history: SYMBOL,
        end: beforeEpoch,
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

        // Seguimos bajando mientras no lleguemos al inicio del día (con colchón para SMA)
        if (times[0] > (startEpoch - 3600) && chunk.length > 0 && allTicks.length < 100000) {
            process.stdout.write('.');
            fetchTicks(times[0]);
        } else {
            console.log(`\n✅ DATA CARGADA: ${allTicks.length} ticks.`);
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

    console.log(`\n📊 SIMULANDO 24 HORAS del 2 DE FEBRERO...`);
    console.log(`Config: TP $3 | SL $1.5 | Mom 5 | SMA 200 | MODO ACTUAL`);

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
                let floor = (Math.floor(maxProfit / 0.1) * 0.1) - CONFIG.trailDist;
                if (floor > lastSl) lastSl = floor;
            }

            if (prof <= -CONFIG.stopLoss) {
                balance -= CONFIG.stopLoss; losses++; inTrade = false; totalTrades++;
            } else if (prof >= CONFIG.takeProfit) {
                balance += CONFIG.takeProfit; wins++; inTrade = false; totalTrades++;
            } else if (lastSl > -99 && prof <= lastSl) {
                balance += lastSl; if (lastSl > 0) wins++; else losses++; inTrade = false; totalTrades++;
            }
        }
    }

    console.log("=========================================");
    console.log("🏆 RESULTADO FEB 2, 2026 (24H)");
    console.log("=========================================");
    console.log(`Total Trades: ${totalTrades}`);
    console.log(`Ganadas: ${wins} ✅`);
    console.log(`Perdidas: ${losses} ❌`);
    console.log(`PnL Neto: $${balance.toFixed(2)} 💰`);
    console.log(`Win Rate: ${((wins / (totalTrades || 1)) * 100).toFixed(1)}%`);
    console.log("=========================================");
}
