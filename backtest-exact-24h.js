const WebSocket = require('ws');
const APP_ID = 1089;
const SYMBOL = 'R_100';

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
let allTicks = [];
const TOTAL_TICKS_NEEDED = 80000; // ~24 horas

// CONFIGURACIÓN EXACTA DE TU SERVER-BOT.JS
const CONFIG = {
    stake: 20,
    takeProfit: 3.00,
    stopLoss: 1.50,
    multiplier: 40,
    smaPeriod: 50,
    smaLongPeriod: 200,
    rsiPeriod: 14,
    rsiLow: 45,
    rsiHigh: 55,
    momentum: 5,
    distLimit: 0.08, // El filtro de distancia "Premium"
    trailStart: 0.50,
    trailDist: 0.50
};

ws.on('open', () => {
    console.log(`📥 Descargando DATA TICKS para BACKTEST EXACTO (Últimas 24H)...`);
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

    console.log(`\n📊 SIMULANDO 24 HORAS CON TU CONFIGURACIÓN ACTUAL (PREMIUM)...`);
    console.log(`Filtros: SMA200 + RSI(45-55) + Distancia < 0.08%`);

    for (let i = 250; i < allTicks.length; i++) {
        const quote = allTicks[i];

        if (!inTrade) {
            const last5 = allTicks.slice(i - CONFIG.momentum, i);
            const allUp = last5.every((v, j) => j === 0 || v > last5[j - 1]);
            const allDown = last5.every((v, j) => j === 0 || v < last5[j - 1]);

            const sma50 = calculateSMA(allTicks.slice(0, i), CONFIG.smaPeriod);
            const sma200 = calculateSMA(allTicks.slice(0, i), CONFIG.smaLongPeriod);
            const rsi = calculateRSI(allTicks.slice(0, i), 14);

            if (sma50 && sma200 && rsi) {
                const distPct = Math.abs(quote - sma50) / sma50 * 100;

                // FILTRO DE DISTANCIA 0.08% (Igual que en tu servidor)
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
                let floor = (Math.floor(maxProfit / 0.5) * 0.5) - CONFIG.trailDist;
                if (floor > lastSl) lastSl = floor;
            }

            if (prof <= -CONFIG.stopLoss) {
                balance -= CONFIG.stopLoss; losses++; inTrade = false;
            } else if (prof >= CONFIG.takeProfit) {
                balance += CONFIG.takeProfit; wins++; inTrade = false;
            } else if (lastSl > -99 && prof <= lastSl) {
                balance += lastSl; if (lastSl > 0) wins++; else losses++; inTrade = false;
            }
        }
    }

    console.log("=========================================");
    console.log("🏆 RESULTADO 24H (CON TU BOT ACTUAL)");
    console.log("=========================================");
    console.log(`Total Trades: ${trades}`);
    console.log(`Ganadas: ${wins} ✅ | Perdidas: ${losses} ❌`);
    console.log(`PnL Neto: $${balance.toFixed(2)} 💰`);
    console.log(`Win Rate: ${((wins / (trades || 1)) * 100).toFixed(1)}%`);
    console.log("=========================================");
}
