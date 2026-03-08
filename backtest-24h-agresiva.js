const WebSocket = require('ws');
const APP_ID = 1089;
const SYMBOL = 'R_100';

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
let allCandles = [];
const TOTAL_CANDLES_NEEDED = 1440; // 24 horas exactas (1440 minutos)

// CONFIGURACIÓN AGRESIVA ACTUAL (La que tienes en el aire)
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
    console.log("📥 Descargando DATA para Backtest de 24 HORAS...");
    fetchChunk();
});

function fetchChunk(beforeEpoch = 'latest') {
    ws.send(JSON.stringify({
        ticks_history: SYMBOL,
        end: beforeEpoch || 'latest',
        count: 2000, // Traemos un poco más para el SMA200
        granularity: 60,
        style: 'candles'
    }));
}

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.msg_type === 'candles') {
        allCandles = msg.candles || [];
        console.log(`✅ Data cargada: ${allCandles.length} velas.`);
        runSimulation();
        ws.close();
    }
});

function calculateSMA(data, period) {
    if (data.length < period) return null;
    let sum = 0;
    for (let i = 0; i < period; i++) sum += data[data.length - 1 - i];
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
    const closes = allCandles.map(c => c.close);
    let balance = 0, wins = 0, losses = 0, trades = 0;
    let inTrade = false, entryPrice = 0, tradeType = null, maxProfit = 0, lastSl = -100;

    console.log(`\n📊 SIMULANDO ÚLTIMAS 24 HORAS...`);
    console.log(`Config: TP $3 | SL $1.5 | Mom 5 | SMA 200 | SIN FILTRO DISTANCIA`);

    // Empezamos después del periodo del SMA200 y miramos las últimas 1440 velas
    const startPoint = Math.max(200, allCandles.length - 1440);

    for (let i = startPoint; i < allCandles.length; i++) {
        const c = allCandles[i];

        let signal = null;
        const last5 = closes.slice(i - CONFIG.momentum, i);
        const allUp = last5.every((v, idx) => idx === 0 || v > last5[idx - 1]);
        const allDown = last5.every((v, idx) => idx === 0 || v < last5[idx - 1]);

        if (!inTrade) {
            const sma200 = calculateSMA(closes.slice(0, i), CONFIG.smaLongPeriod);
            const rsi = calculateRSI(closes.slice(0, i), 14);

            if (sma200 && rsi) {
                // LÓGICA AGRESIVA ACTUAL
                if (allUp && c.close > sma200 && rsi > 45) signal = 'UP';
                if (allDown && c.close < sma200 && rsi < 55) signal = 'DOWN';
            }
        }

        if (inTrade) {
            const prices = [c.open, c.high, c.low, c.close];
            for (let p of prices) {
                let diff = (p - entryPrice) / entryPrice;
                if (tradeType === 'DOWN') diff = -diff;
                let prof = diff * CONFIG.multiplier * CONFIG.stake;
                if (prof > maxProfit) maxProfit = prof;

                if (maxProfit >= CONFIG.trailStart) {
                    let floor = (Math.floor(maxProfit / 0.5) * 0.5) - CONFIG.trailDist;
                    if (floor > lastSl) lastSl = floor;
                }

                if (prof <= -CONFIG.stopLoss) { balance -= CONFIG.stopLoss; losses++; inTrade = false; break; }
                if (prof >= CONFIG.takeProfit) { balance += CONFIG.takeProfit; wins++; inTrade = false; break; }
                if (lastSl > -99 && prof <= lastSl) {
                    balance += lastSl; if (lastSl > 0) wins++; else losses++; inTrade = false; break;
                }
            }
        } else if (signal) {
            inTrade = true; tradeType = signal; entryPrice = c.close; maxProfit = 0; lastSl = -100; trades++;
        }
    }

    console.log("=========================================");
    console.log("🏆 RESULTADO FINAL 24 HORAS");
    console.log("=========================================");
    console.log(`Total Trades: ${trades}`);
    console.log(`Ganadas: ${wins} ✅`);
    console.log(`Perdidas: ${losses} ❌`);
    console.log(`PnL Neto: $${balance.toFixed(2)} 💰`);
    console.log(`Win Rate: ${((wins / trades) * 100).toFixed(1)}%`);
    console.log("=========================================");
}
