const WebSocket = require('ws');
const APP_ID = 1089;
const SYMBOL = 'R_100';

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
let allTicks = [];
const TOTAL_TICKS_NEEDED = 84000; // ~24 Horas de data real

// CONFIGURACIÓN ACTUAL "AMETRALLADORA" + FILTRO 1 MINUTO
const CONFIG = {
    stake: 20,
    takeProfit: 3.00,
    stopLoss: 1.80,      // Realidad Slippage
    multiplier: 40,
    smaPeriod: 50,
    smaLongPeriod: 200,
    rsiPeriod: 14,
    rsiLow: 20,
    rsiHigh: 80,
    momentum: 3,
    distLimit: 0.15,
    trailStart: 0.50,
    trailDist: 0.55
};

ws.on('open', () => {
    console.log(`📥 Descargando DATA TICKS para BACKTEST AMETRALLADORA + FILTRO 1 MINUTO (24H)...`);
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

                // FILTRO DE 1 MINUTO (Tendencia local)
                let minuteTrend = 'NEUTRAL';
                const price1minAgo = allTicks[i - 60];
                if (quote > price1minAgo) minuteTrend = 'UP';
                else if (quote < price1minAgo) minuteTrend = 'DOWN';

                if (distPct < CONFIG.distLimit) {
                    let trigger = null;
                    if (allUp && quote > sma200 && rsi > CONFIG.rsiLow && minuteTrend === 'UP') {
                        trigger = 'UP';
                    } else if (allDown && quote < sma200 && rsi < CONFIG.rsiHigh && minuteTrend === 'DOWN') {
                        trigger = 'DOWN';
                    }

                    if (trigger) {
                        inTrade = true; tradeType = trigger; entryPrice = quote; maxProfit = 0; lastSl = -100; trades++;
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
    console.log("🏆 RESULTADO 24H: AMETRALLADORA + 1MIN FILTER");
    console.log("=========================================");
    console.log(`Total Trades (24H): ${trades}`);
    console.log(`Ganadas: ${wins} ✅ | Perdidas: ${losses} ❌`);
    console.log(`PnL Neto 24H: $${balance.toFixed(2)} 💰`);
    console.log(`Win Rate: ${((wins / (trades || 1)) * 100).toFixed(1)}%`);
    console.log(`Pérdida por Trade: $1.80 (Realidad Slippage)`);
    console.log("=========================================");
}
