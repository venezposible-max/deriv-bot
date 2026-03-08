const WebSocket = require('ws');
const APP_ID = 1089;
const SYMBOL = 'R_100';

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
let allTicks = [];
const TOTAL_TICKS_NEEDED = 84000; // 24H

const CONFIG = {
    stake: 20,
    takeProfit: 3.00,
    stopLoss: 1.80,
    multiplier: 40,
    smaPeriod: 50,
    smaLongPeriod: 200,
    rsiPeriod: 14,
    momentum: 3,
    distLimit: 0.15,
    trailStart: 0.50,
    trailDist: 0.55
};

ws.on('open', () => {
    console.log(`📥 Descargando DATA TICKS para Búsqueda de PRECISIÓN (24H)...`);
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
            optimizeAccuracy();
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

function calculateATR(ticks) {
    if (ticks.length < 14) return 0;
    let diffs = 0;
    for (let i = 1; i < ticks.length; i++) diffs += Math.abs(ticks[i] - ticks[i - 1]);
    return diffs / ticks.length;
}

function runSimulation(params) {
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
            const atr = calculateATR(allTicks.slice(i - 20, i));

            if (sma50 && sma200 && rsi) {
                const distPct = Math.abs(quote - sma50) / sma50 * 100;

                // Filtro 1Min
                const price1minAgo = allTicks[i - 60];
                const trend1min = quote > price1minAgo ? 'UP' : 'DOWN';

                // FILTROS DE PRECISIÓN
                const passRSI = (rsi > params.rsiLow && rsi < params.rsiHigh);
                const passDist = distPct < params.distLimit;
                const passTrend = (trend1min === (allUp ? 'UP' : 'DOWN'));
                const passATR = atr > params.minATR; // Solo si hay movimiento real

                if (passRSI && passDist && passTrend && passATR) {
                    if (allUp && quote > sma200) {
                        inTrade = true; tradeType = 'UP'; entryPrice = quote; maxProfit = 0; lastSl = -100; trades++;
                    } else if (allDown && quote < sma200) {
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
                const step = Math.floor(maxProfit / 0.50) * 0.50;
                if (step - CONFIG.trailDist > lastSl) lastSl = step - CONFIG.trailDist;
            }

            let closed = false;
            let pnl = 0;
            if (prof <= -1.45) { pnl = -1.80; closed = true; }
            else if (prof >= 3.00) { pnl = 3.00; closed = true; }
            else if (lastSl > -99 && prof <= lastSl) { pnl = lastSl; closed = true; }

            if (closed) {
                balance += pnl;
                if (pnl > 0) wins++; else losses++;
                inTrade = false;
            }
        }
    }
    return { balance, wins, losses, trades };
}

function optimizeAccuracy() {
    console.log(`\n====================================================`);
    console.log(`🎯 BÚSQUEDA DE MÁXIMA PRECISIÓN (24H)`);
    console.log(`====================================================`);

    const tests = [
        { name: "Ametralladora (Act)", rsiLow: 20, rsiHigh: 80, distLimit: 0.15, minATR: 0 },
        { name: "+ Filtro 1Min", rsiLow: 20, rsiHigh: 80, distLimit: 0.15, minATR: 0 },
        { name: "+ Precisión RSI (30/70)", rsiLow: 30, rsiHigh: 70, distLimit: 0.15, minATR: 0 },
        { name: "+ Filtro Volatilidad (ATR)", rsiLow: 20, rsiHigh: 80, distLimit: 0.15, minATR: Math.floor(allTicks[100] * 0.0001) }, // Filtro dinámico
        { name: "🎯 SNIPER ELITE (Todo junto)", rsiLow: 35, rsiHigh: 65, distLimit: 0.10, minATR: 0.05 }
    ];

    console.log(`MODELO              | TRADES | WIN % | PnL 24H`);
    console.log(`----------------------------------------------------`);

    tests.forEach(t => {
        const res = runSimulation(t);
        const wr = (res.wins / (res.trades || 1) * 100).toFixed(1);
        console.log(`${t.name.padEnd(19)} | ${res.trades.toString().padStart(6)} | ${wr}% | $${res.balance.toFixed(2).padStart(8)}`);
    });
    console.log(`====================================================`);
}
