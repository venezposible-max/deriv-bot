const WebSocket = require('ws');
const APP_ID = 1089;
const SYMBOL = 'R_100';

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

// CONFIGURACIÓN ACTUAL DEL BOT EN VIVO
const CONFIG = {
    stake: 20,
    takeProfit: 3.0,
    multiplier: 40,
    momentum: 5,
    stopLoss: 1.5,
    trailStart: 0.5,
    trailDist: 0.5,
    smaPeriod: 50,
    smaLongPeriod: 200
};

ws.on('open', () => {
    console.log("📥 Descargando los ÚLTIMOS TICKS (Precisión Real)...");
    ws.send(JSON.stringify({
        ticks_history: SYMBOL,
        end: 'latest',
        count: 5000, // Aproximadamente 1.5 a 2 horas de data real
        style: 'ticks'
    }));
});

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.msg_type === 'history') {
        runTickBacktest(msg.history.prices);
        ws.close();
    }
});

function calculateSMA(prices, period) {
    if (prices.length < period) return null;
    let sum = 0;
    for (let i = 0; i < period; i++) sum += prices[prices.length - 1 - i];
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

function runTickBacktest(ticks) {
    let balance = 0, wins = 0, losses = 0, trades = 0;
    let inTrade = false, entryPrice = 0, tradeType = null, maxProfit = 0, lastSl = -100;

    console.log(`\n🔍 ANALIZANDO ${ticks.length} TICKS RECIENTES...`);
    console.log(`Estrategia: SMA 200 + Momentum 5 (Sin Filtro de Distancia)`);

    for (let i = 250; i < ticks.length; i++) {
        const quote = ticks[i];
        const last5 = ticks.slice(i - CONFIG.momentum, i);
        const allUp = last5.every((v, idx) => idx === 0 || v > last5[idx - 1]);
        const allDown = last5.every((v, idx) => idx === 0 || v < last5[idx - 1]);

        if (!inTrade) {
            const sma200 = calculateSMA(ticks.slice(0, i), CONFIG.smaLongPeriod);
            const rsi = calculateRSI(ticks.slice(0, i), 14);

            if (sma200 && rsi) {
                if (allUp && quote > sma200 && rsi > 45) {
                    inTrade = true; tradeType = 'UP'; entryPrice = quote; maxProfit = 0; lastSl = -100; trades++;
                } else if (allDown && quote < sma200 && rsi < 55) {
                    inTrade = true; tradeType = 'DOWN'; entryPrice = quote; maxProfit = 0; lastSl = -100; trades++;
                }
            }
        } else {
            // Gestión del trade abierto
            let diff = (quote - entryPrice) / entryPrice;
            if (tradeType === 'DOWN') diff = -diff;
            let prof = diff * CONFIG.multiplier * CONFIG.stake;

            if (prof > maxProfit) maxProfit = prof;

            // Trailing Stop de $0.50
            if (maxProfit >= CONFIG.trailStart) {
                let floor = (Math.floor(maxProfit / 0.5) * 0.5) - CONFIG.trailDist;
                if (floor > lastSl) lastSl = floor;
            }

            // Salidas
            if (prof <= -CONFIG.stopLoss) {
                balance -= CONFIG.stopLoss; losses++; inTrade = false;
            } else if (prof >= CONFIG.takeProfit) {
                balance += CONFIG.takeProfit; wins++; inTrade = false;
            } else if (lastSl > -99 && prof <= lastSl) {
                balance += lastSl; if (lastSl > 0) wins++; else losses++; inTrade = false;
            }
        }
    }

    console.log("\n=========================================");
    console.log("📊 RESULTADO ÚLTIMA HORA (TICK-BY-TICK)");
    console.log("=========================================");
    console.log(`Total Trades: ${trades}`);
    console.log(`Ganados: ${wins} ✅`);
    console.log(`Perdidos: ${losses} ❌`);
    console.log(`PnL: $${balance.toFixed(2)} 💰`);
    console.log("=========================================");
}
