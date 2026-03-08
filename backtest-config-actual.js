const WebSocket = require('ws');
const APP_ID = 1089;
const SYMBOL = 'stpRNG';

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
let allTicks = [];
const TOTAL_TICKS_NEEDED = 86400; // ~24 Horas

// 🎯 TU CONFIGURACIÓN EXACTA (Según Captura Actualizada)
const CONFIG = {
    stake: 20,
    takeProfit: 3.00,
    stopLoss: 3.00,    // El que tienes puesto en el panel
    multiplier: 750,
    smaPeriod: 50,
    smaLongPeriod: 200,
    rsiPeriod: 14,
    rsiLow: 25,
    rsiHigh: 75,
    momentum: 5,       // El que tienes puesto en el panel
    distLimit: 0.08,   // Valor de precisión por defecto
    trailStart: 0.50,
    trailDist: 0.30    // Protegemos $0.20 al tocar los $0.50
};

ws.on('open', () => {
    console.log(`\n📥 EJECUTANDO BACKTEST 24H CON TU CONFIGURACIÓN EXACTA...`);
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
            console.log(`\n✅ DATA OK.`);
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
    let inTrade = false, entryPrice = 0, tradeType = null, maxProfit = 0, lastSl = -99;

    for (let i = 250; i < allTicks.length; i++) {
        const quote = allTicks[i];

        if (!inTrade) {
            const lastTicks = allTicks.slice(i - CONFIG.momentum, i);
            const allUp = lastTicks.every((v, idx, arr) => idx === 0 || v > arr[idx - 1]);
            const allDown = lastTicks.every((v, idx, arr) => idx === 0 || v < arr[idx - 1]);
            const sma50 = calculateSMA(allTicks.slice(0, i), CONFIG.smaPeriod);
            const sma200 = calculateSMA(allTicks.slice(0, i), CONFIG.smaLongPeriod);
            const rsi = calculateRSI(allTicks.slice(0, i), CONFIG.rsiPeriod);

            if (sma50 && sma200 && rsi) {
                const distPct = Math.abs(quote - sma50) / sma50 * 100;
                if (distPct < CONFIG.distLimit && rsi > CONFIG.rsiLow && rsi < CONFIG.rsiHigh) {
                    if (allUp && quote > sma200) { inTrade = true; tradeType = 'UP'; entryPrice = quote; maxProfit = 0; lastSl = -99; trades++; }
                    else if (allDown && quote < sma200) { inTrade = true; tradeType = 'DOWN'; entryPrice = quote; maxProfit = 0; lastSl = -99; trades++; }
                }
            }
        } else {
            let diff = (quote - entryPrice);
            if (tradeType === 'DOWN') diff = -diff;
            const prof = diff * 7.5;
            if (prof > maxProfit) maxProfit = prof;

            // Trailing Maestro Actual del Código
            if (maxProfit >= CONFIG.trailStart) {
                const step = Math.floor(maxProfit / 0.50) * 0.50;
                const newFloor = step - CONFIG.trailDist;
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
    console.log("🏙️ REPORTE 24H: TU CONFIGURACIÓN EXACTA");
    console.log("=========================================");
    console.log(`Símbolo: STEP INDEX | Multiplicador: 750`);
    console.log(`Stake: $${CONFIG.stake} | TP: $${CONFIG.takeProfit} | SL: $${CONFIG.stopLoss}`);
    console.log(`Momentum: ${CONFIG.momentum} | Límite Distancia: ${CONFIG.distLimit}%`);
    console.log(`Trailing: -$0.30 desde el escalón de +$0.50`);
    console.log(`-----------------------------------------`);
    console.log(`Total Trades: ${trades}`);
    console.log(`Ganadas: ${wins} ✅ | Perdidas: ${losses} ❌`);
    console.log(`Win Rate Global: ${((wins / (trades || 1)) * 100).toFixed(1)}%`);
    console.log(`-----------------------------------------`);
    console.log(`GANANCIA FINAL 24H: $${balance.toFixed(2)} 💰 🔥`);
    console.log("=========================================");
}
