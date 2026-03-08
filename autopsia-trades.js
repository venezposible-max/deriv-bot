const WebSocket = require('ws');
const APP_ID = 1089;
const SYMBOL = 'R_100';

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
let allTicks = [];
const TICKS_TO_FETCH = 6000; // Suficiente para 1.5 horas

// 🎯 CONFIGURACIÓN EXACTA ACTUAL DE RAILWAY
const CONFIG = {
    stake: 20,
    takeProfit: 3.00,
    stopLoss: 1.80,      // Realidad Slippage
    multiplier: 40,
    smaPeriod: 50,
    smaLongPeriod: 200,
    rsiPeriod: 14,
    rsiLow: 25,
    rsiHigh: 75,
    momentum: 3,
    distLimit: 0.12,
    trailStart: 0.50,
    trailDist: 0.55
};

ws.on('open', () => {
    console.log(`📥 Descargando DATA TICKS para ANÁLISIS DE FALLOS (Últimos 60 min)...`);
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
            console.log(`\n✅ DATA OK: Analizando los trades fallidos de la última hora...`);
            runAnalysis();
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

function runAnalysis() {
    let balance = 0, wins = 0, losses = 0, trades = 0;
    let inTrade = false, entryPrice = 0, tradeType = null, maxProfit = 0, lastSl = -100;

    // Ventana de simulación (aprox 1 hora)
    const simulationTicks = allTicks.slice(-3600);

    console.log(`\n====================================================`);
    console.log(`🕵️‍♂️ INFORME DE AUTOPSIA: ÚLTIMA HORA (SNIPER ELITE)`);
    console.log(`====================================================`);
    console.log(`ID | TIPO | RSI | DIST % | RESULTADO | PnL | BALANCE`);
    console.log(`----------------------------------------------------`);

    for (let i = 250; i < simulationTicks.length; i++) {
        const quote = simulationTicks[i];

        if (!inTrade) {
            const lastTicks = simulationTicks.slice(i - CONFIG.momentum, i);
            const allUp = lastTicks.every((v, j) => j === 0 || v > lastTicks[j - 1]);
            const allDown = lastTicks.every((v, j) => j === 0 || v < lastTicks[j - 1]);

            const sma50 = calculateSMA(simulationTicks.slice(0, i), CONFIG.smaPeriod);
            const sma200 = calculateSMA(simulationTicks.slice(0, i), CONFIG.smaLongPeriod);
            const rsi = calculateRSI(simulationTicks.slice(0, i), 14);
            const price1m = simulationTicks[i - 60] || simulationTicks[0];
            const trend1m = quote > price1m ? 'UP' : 'DOWN';

            // Filtro Volatilidad
            const last5 = simulationTicks.slice(i - 5, i);
            let volSum = 0;
            for (let j = 1; j < last5.length; j++) volSum += Math.abs(last5[j] - last5[j - 1]);
            const volOK = (volSum / 5) > 0.015;

            if (sma50 && sma200 && rsi && volOK) {
                const distPct = Math.abs(quote - sma50) / sma50 * 100;

                let trigger = null;
                if (distPct < CONFIG.distLimit && (rsi > CONFIG.rsiLow && rsi < CONFIG.rsiHigh)) {
                    if (allUp && quote > sma200 && trend1m === 'UP') trigger = 'UP';
                    else if (allDown && quote < sma200 && trend1m === 'DOWN') trigger = 'DOWN';
                }

                if (trigger) {
                    inTrade = true; tradeType = trigger; entryPrice = quote; maxProfit = 0; lastSl = -1.50; trades++;
                    this_trade = { id: trades, type: trigger, rsi: rsi.toFixed(1), dist: distPct.toFixed(3) };
                }
            }
        } else {
            let diff = (quote - entryPrice) / entryPrice;
            if (tradeType === 'DOWN') diff = -diff;
            let prof = diff * CONFIG.multiplier * CONFIG.stake;
            if (prof > maxProfit) maxProfit = prof;

            if (maxProfit >= 0.50) {
                const currentStep = Math.floor(maxProfit / 0.50) * 0.50;
                const newFloor = currentStep - 0.55;
                if (newFloor > lastSl) lastSl = newFloor;
            }

            let closed = false;
            let pnl = 0;
            let resTxt = "";

            if (prof <= -1.45) { pnl = -CONFIG.stopLoss; resTxt = "❌ LOSS"; closed = true; }
            else if (prof >= CONFIG.takeProfit) { pnl = CONFIG.takeProfit; resTxt = "✅ TARGET"; closed = true; }
            else if (lastSl > -99 && prof <= lastSl) { pnl = lastSl; resTxt = (pnl >= 0 ? "🛡️ TRAIL+" : "🛡️ TRAIL-"); closed = true; }

            if (closed) {
                balance += pnl;
                if (pnl > 0) wins++; else losses++;
                inTrade = false;
                console.log(`${this_trade.id.toString().padStart(2)} | ${this_trade.type.padEnd(4)} | ${this_trade.rsi.padStart(4)} | ${this_trade.dist.padStart(6)} | ${resTxt.padEnd(9)} | $${pnl.toFixed(2).padStart(5)} | $${balance.toFixed(2).padStart(7)}`);
            }
        }
    }

    console.log(`----------------------------------------------------`);
    console.log(`RESUMEN AUTOPSIA:`);
    console.log(`- Trades Totales: ${trades}`);
    console.log(`- Win Rate: ${((wins / trades) * 100).toFixed(1)}%`);
    console.log(`- PnL Neto 1H: $${balance.toFixed(2)}`);
    console.log(`- Nota: Si el RSI estuvo fuera de 25-75, el bot no disparó.`);
    console.log("====================================================");
}
