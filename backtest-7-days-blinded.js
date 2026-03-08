const WebSocket = require('ws');
const APP_ID = 1089;
const SYMBOL = 'stpRNG';

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
let allTicks = [];
const TOTAL_TICKS_NEEDED = 604800; // ~7 Días (estimación ticks)

const CONFIG = {
    stake: 20,
    takeProfit: 3.00,
    stopLoss: 3.00,
    multiplier: 750,
    smaPeriod: 50,
    smaLongPeriod: 200,
    rsiPeriod: 14,
    rsiLow: 25,
    rsiHigh: 75,
    momentum: 3,
    distLimit: 0.15
};

ws.on('open', () => {
    console.log(`\n📥 DESCARGANDO DATA HISTÓRICA DE 7 DÍAS PARA STEP INDEX (MODO BLINDADO)...`);
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
            if (allTicks.length % 50000 === 0) process.stdout.write('📦');
            else process.stdout.write('.');
            fetchTicks(times[0]);
        } else {
            console.log(`\n✅ DATA RECUPERADA: ${allTicks.length} ticks (${(allTicks.length / 86400).toFixed(1)} días aprox).`);
            runSim();
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

function runSim() {
    let balance = 0, wins = 0, losses = 0, trades = 0;
    let dailyStats = {};
    let currentDay = 0;

    let inTrade = false, entryPrice = 0, tradeType = null, maxProfit = 0, lastSl = -99;

    for (let i = 250; i < allTicks.length; i++) {
        // Seguimiento por días (aprox)
        let dayIdx = Math.floor(i / 86400);

        if (!inTrade) {
            const lastTicks = allTicks.slice(i - CONFIG.momentum, i);
            const allUp = lastTicks.every((v, idx, arr) => idx === 0 || v > arr[idx - 1]);
            const allDown = lastTicks.every((v, idx, arr) => idx === 0 || v < arr[idx - 1]);

            const sma50 = calculateSMA(allTicks.slice(0, i), CONFIG.smaPeriod);
            const sma200 = calculateSMA(allTicks.slice(0, i), CONFIG.smaLongPeriod);
            const rsi = calculateRSI(allTicks.slice(0, i), CONFIG.rsiPeriod);

            if (sma50 && sma200 && rsi) {
                const distPct = Math.abs(allTicks[i] - sma50) / sma50 * 100;

                if (distPct < CONFIG.distLimit && rsi > CONFIG.rsiLow && rsi < CONFIG.rsiHigh) {
                    if (allUp && allTicks[i] > sma200) {
                        inTrade = true; tradeType = 'UP'; entryPrice = allTicks[i]; maxProfit = 0; lastSl = -99; trades++;
                    } else if (allDown && allTicks[i] < sma200) {
                        inTrade = true; tradeType = 'DOWN'; entryPrice = allTicks[i]; maxProfit = 0; lastSl = -99; trades++;
                    }
                }
            }
        } else {
            let diff = (allTicks[i] - entryPrice);
            if (tradeType === 'DOWN') diff = -diff;

            const prof = diff * 7.5;

            if (prof > maxProfit) maxProfit = prof;

            if (maxProfit >= 0.50) {
                const step = Math.floor(maxProfit / 0.50) * 0.50;
                const newFloor = step - 0.30;
                if (newFloor > lastSl) lastSl = newFloor;
            }

            let closed = false, pnl = 0;
            if (prof >= CONFIG.takeProfit) { pnl = CONFIG.takeProfit; closed = true; }
            else if (prof <= -CONFIG.stopLoss) { pnl = -CONFIG.stopLoss; closed = true; }
            else if (lastSl > -90 && prof <= lastSl) { pnl = lastSl; closed = true; }

            if (closed) {
                balance += pnl;
                if (pnl > 0) wins++; else losses++;
                inTrade = false;
            }
        }
    }

    console.log("\n=========================================");
    console.log("💰 REPORTE MAESTRO 7 DÍAS: MODO BLINDADO");
    console.log("=========================================");
    console.log(`Símbolo: ${SYMBOL} | Modo: Sniper Elite`);
    console.log(`Config: TP $3 | SL $3 | Mom 3 | Dist 0.15%`);
    console.log(`-----------------------------------------`);
    console.log(`Total de Operaciones: ${trades}`);
    console.log(`Ratio Win/Loss: ${wins} ✅ / ${losses} ❌`);
    console.log(`Win Rate Global: ${((wins / (trades || 1)) * 100).toFixed(1)}%`);
    console.log(`-----------------------------------------`);
    console.log(`GANANCIA TOTAL 7 DÍAS: $${balance.toFixed(2)} 💰 🔥`);
    console.log(`PROMEDIO DIARIO: $${(balance / 7).toFixed(2)} 💎`);
    console.log(`PROMEDIO MENSUAL PROYECTADO: $${(balance * 4).toFixed(2)} 🚀`);
    console.log("=========================================");
}
