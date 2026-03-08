const WebSocket = require('ws');
const APP_ID = 1089;
const SYMBOL = 'R_100';

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
let allTicks = [];
const TOTAL_TICKS_NEEDED = 22000; // ~6 Horas (1 tick/seg aprox)

// CONFIGURACIÓN ACTUAL "AMETRALLADORA" (La que tienes activa en Railway)
const CONFIG = {
    stake: 20,
    takeProfit: 3.00,
    stopLoss: 1.80,      // 🚨 REALIDAD CRUDA (Incluye el retraso de cierre -$1.80)
    multiplier: 40,
    smaPeriod: 50,
    smaLongPeriod: 200,
    rsiPeriod: 14,
    rsiLow: 20,          // Suavizado (NUEVO)
    rsiHigh: 80,         // Suavizado (NUEVO)
    momentum: 3,          // Más rápido (NUEVO)
    distLimit: 0.15,     // Más rango (NUEVO)
    trailStart: 0.50,
    trailDist: 0.55      // Latencia en el Trailing
};

ws.on('open', () => {
    console.log(`📥 Descargando DATA TICKS para BACKTEST AMETRALLADORA (Las últimas 6 HORAS)...`);
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
    let balance = 0, wins = 0, losses = 0, trades = 0;
    let inTrade = false, entryPrice = 0, tradeType = null, maxProfit = 0, lastSl = -100;

    for (let i = 250; i < allTicks.length; i++) {
        const quote = allTicks[i];

        if (!inTrade) {
            const lastTicks = allTicks.slice(i - CONFIG.momentum, i);
            const allUp = lastTicks.every((v, j) => j === 0 || v > lastTicks[j - 1]);
            const allDown = lastTicks.every((v, j) => j === 0 || v < lastTicks[j - 1]);

            const sma50 = calculateSMA(allTicks.slice(0, i), CONFIG.smaPeriod);
            const sma200 = calculateSMA(allTicks.slice(0, i), CONFIG.smaLongPeriod);
            const rsi = calculateRSI(allTicks.slice(0, i), 14);

            if (sma50 && sma200 && rsi) {
                const distPct = Math.abs(quote - sma50) / sma50 * 100;

                if (distPct < CONFIG.distLimit) {
                    if (allUp && quote > sma200 && rsi > CONFIG.rsiLow) {
                        inTrade = true; tradeType = 'UP'; entryPrice = quote; maxProfit = 0; lastSl = -100; trades++;
                    } else if (allDown && quote < sma200 && rsi < CONFIG.rsiHigh) {
                        inTrade = true; tradeType = 'DOWN'; entryPrice = quote; maxProfit = 0; lastSl = -100; trades++;
                    }
                }
            }
        } else {
            let diff = (quote - entryPrice) / entryPrice;
            if (tradeType === 'DOWN') diff = -diff;
            let prof = diff * CONFIG.multiplier * CONFIG.stake;
            if (prof > maxProfit) maxProfit = prof;

            if (maxProfit >= CONFIG.trailStart) {
                const currentStep = Math.floor(maxProfit / 0.50) * 0.50;
                const newFloor = currentStep - CONFIG.trailDist;
                if (newFloor > lastSl) lastSl = newFloor;
            }

            let closed = false;
            let pnl = 0;

            if (prof <= -1.45) { // Gatillo de SL real
                pnl = -CONFIG.stopLoss; closed = true;
            } else if (prof >= CONFIG.takeProfit) {
                pnl = CONFIG.takeProfit; closed = true;
            } else if (lastSl > -99 && prof <= lastSl) {
                pnl = lastSl; closed = true;
            }

            if (closed) {
                balance += pnl;
                if (pnl > 0) wins++; else losses++;
                inTrade = false;
            }
        }
    }

    console.log("=========================================");
    console.log("🏆 RESULTADO 6 HORAS: AMETRALLADORA");
    console.log("=========================================");
    console.log(`Total Trades (6H): ${trades}`);
    console.log(`Ganadas: ${wins} ✅ | Perdidas: ${losses} ❌`);
    console.log(`PnL Neto 6 Horas: $${balance.toFixed(2)} 💰`);
    console.log(`Promedio x Hora: $${(balance / 6).toFixed(2)}`);
    console.log("=========================================");
}
