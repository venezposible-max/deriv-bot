const WebSocket = require('ws');
const APP_ID = 1089;
const SYMBOL = 'stpRNG'; // Step Index Real

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
let allTicks = [];
const TOTAL_TICKS_NEEDED = 86400; // ~24 Horas (1 tick por segundo aprox)

// 🎯 CONFIGURACIÓN SNIPER ELITE (Ajuste 0.08 + Momentum 5)
const CONFIG = {
    stake: 20,
    takeProfit: 3.00,
    stopLoss: 1.80,
    multiplier: 40,
    smaPeriod: 50,
    smaLongPeriod: 200,
    rsiPeriod: 14,
    rsiLow: 25,
    rsiHigh: 75,
    momentum: 5,
    distLimit: 0.08,
    trailStart: 0.50,
    trailDist: 0.55
};

ws.on('open', () => {
    console.log(`📥 Descargando DATA TICKS para STEP INDEX (Reporte 24 HORAS)...`);
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
            console.log(`\n✅ DATA OK: ${allTicks.length} ticks para STEP INDEX.`);
            runStepIndex24hSim();
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

function runStepIndex24hSim() {
    let balance = 0, wins = 0, losses = 0, trades = 0;
    let inTrade = false, entryPrice = 0, tradeType = null, maxProfit = 0, lastSl = -100;

    for (let i = 250; i < allTicks.length; i++) {
        const quote = allTicks[i];

        if (!inTrade) {
            const lastTicks = allTicks.slice(i - CONFIG.momentum, i);
            const allUp = lastTicks.length === CONFIG.momentum && lastTicks.every((v, j) => j === 0 || v > lastTicks[j - 1]);
            const allDown = lastTicks.length === CONFIG.momentum && lastTicks.every((v, j) => j === 0 || v < lastTicks[j - 1]);

            const sma50 = calculateSMA(allTicks.slice(0, i), CONFIG.smaPeriod);
            const sma200 = calculateSMA(allTicks.slice(0, i), CONFIG.smaLongPeriod);
            const rsi = calculateRSI(allTicks.slice(0, i), CONFIG.rsiPeriod);

            // Filtro Volatilidad
            const last5 = allTicks.slice(i - 5, i);
            let volSum = 0;
            for (let j = 1; j < last5.length; j++) volSum += Math.abs(last5[j] - last5[j - 1]);
            const volOK = (volSum / 5) > 0.015;

            // Filtro 1 Minuto
            const price1m = allTicks[i - 60] || allTicks[0];
            const trend1m = quote > price1m ? 'UP' : 'DOWN';

            if (sma50 && sma200 && rsi && volOK) {
                const distPct = Math.abs(quote - sma50) / sma50 * 100;

                if (distPct < CONFIG.distLimit && (rsi > CONFIG.rsiLow && rsi < CONFIG.rsiHigh)) {
                    let trigger = null;
                    if (allUp && quote > sma200 && trend1m === 'UP') trigger = 'UP';
                    else if (allDown && quote < sma200 && trend1m === 'DOWN') trigger = 'DOWN';

                    if (trigger) {
                        inTrade = true; tradeType = trigger; entryPrice = quote; maxProfit = 0; lastSl = -1.50; trades++;
                    }
                }
            }
        } else {
            let diff = (quote - entryPrice);
            if (tradeType === 'DOWN') diff = -diff;

            let prof = diff * 10;
            if (prof > maxProfit) maxProfit = prof;

            if (maxProfit >= 0.50) {
                const step = Math.floor(maxProfit / 0.50) * 0.50;
                if (step - 0.55 > lastSl) lastSl = step - 0.55;
            }

            let closed = false, pnl = 0;

            if (prof <= -1.45) { pnl = -CONFIG.stopLoss; closed = true; }
            else if (prof >= CONFIG.takeProfit) { pnl = CONFIG.takeProfit; closed = true; }
            else if (lastSl > -99 && prof <= lastSl) { pnl = lastSl; closed = true; }

            if (closed) {
                balance += pnl;
                if (pnl > 0) wins++; else losses++;
                inTrade = false;
            }
        }
    }

    console.log("=========================================");
    console.log("🏆 REPORTE 24 HORAS: STEP INDEX (Sniper)");
    console.log("=========================================");
    console.log(`Filtro Distancia: 0.08% | Momentum: 5 ticks`);
    console.log(`-----------------------------------------`);
    console.log(`Total Trades: ${trades}`);
    console.log(`Ganadas: ${wins} ✅ | Perdidas: ${losses} ❌`);
    console.log(`PnL Neto 24H: $${balance.toFixed(2)} 💰 🔥`);
    console.log(`Win Rate: ${((wins / (trades || 1)) * 100).toFixed(1)}%`);
    console.log(`Promedio Diario Proyectado: $${balance.toFixed(2)}`);
    console.log("=========================================");
}
