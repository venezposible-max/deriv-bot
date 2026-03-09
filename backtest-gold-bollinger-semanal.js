const WebSocket = require('ws');
const APP_ID = 1089;
const SYMBOL = 'frxXAUUSD';

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
let allCandles = [];

// Queremos aproximadamente una semana de trading (5 días)
// 60 min * 24 horas * 5 días = 7200 velas M1
const TOTAL_CANDLES_NEEDED = 7500;

const CONFIG = {
    stake: 20,
    takeProfit: 3.00,
    stopLoss: 4.00,
    multiplier: 500,
};

ws.on('open', () => {
    console.log(`\n📥 CARGANDO DATA HISTÓRICA DE ORO (XAUUSD) - ÚLTIMA SEMANA...`);
    console.log(`🧠 Estrategia: Bollinger (20, 2) + RSI (14) en velas M1.`);
    fetchCandles();
});

function fetchCandles(endEpoch = 'latest') {
    ws.send(JSON.stringify({
        ticks_history: SYMBOL,
        end: endEpoch,
        count: 5000,
        style: 'candles',
        granularity: 60
    }));
}

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.msg_type === 'candles') {
        const chunk = msg.candles || [];
        allCandles = [...chunk, ...allCandles];

        if (allCandles.length < TOTAL_CANDLES_NEEDED && chunk.length > 0) {
            process.stdout.write('.');
            fetchCandles(chunk[0].epoch - 1);
        } else {
            console.log(`\n✅ DATA CARGADA (${allCandles.length} minutos). Iniciando Backtest Semanal...`);
            runWeeklyBollingerBacktest();
            ws.close();
        }
    }
});

// --- FUNCIONES TÉCNICAS ---
function calculateSMA(candles, period) {
    if (candles.length < period) return null;
    let sum = 0;
    for (let i = candles.length - period; i < candles.length; i++) {
        sum += candles[i].close;
    }
    return sum / period;
}

function calculateStdDev(candles, period, sma) {
    if (candles.length < period) return null;
    let sumSq = 0;
    for (let i = candles.length - period; i < candles.length; i++) {
        sumSq += Math.pow(candles[i].close - sma, 2);
    }
    return Math.sqrt(sumSq / period);
}

function calculateRSI(candles, period) {
    if (candles.length < period + 1) return 50;
    let gains = 0, losses = 0;
    for (let i = candles.length - period; i < candles.length; i++) {
        let diff = candles[i].close - candles[i - 1].close;
        if (diff >= 0) gains += diff; else losses -= diff;
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    let rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}

function runWeeklyBollingerBacktest() {
    let balance = 0, wins = 0, losses = 0, trades = 0;
    let inTrade = false, entryPrice = 0, tradeType = null;

    // Configuración Bollinger
    const BB_PERIOD = 20;
    const BB_STDDEV = 2.0;

    for (let i = BB_PERIOD; i < allCandles.length; i++) {
        const current = allCandles[i];

        if (!inTrade) {
            const sma = calculateSMA(allCandles.slice(0, i + 1), BB_PERIOD);
            const stdDev = calculateStdDev(allCandles.slice(0, i + 1), BB_PERIOD, sma);
            const rsi = calculateRSI(allCandles.slice(0, i + 1), 14);

            if (!sma || !stdDev) continue;

            const upperBand = sma + (BB_STDDEV * stdDev);
            const lowerBand = sma - (BB_STDDEV * stdDev);

            let direction = null;

            // Entrada al cierre de la vela si perfora banda + RSI extremo
            if (current.close >= upperBand && rsi >= 70) {
                direction = 'DOWN';
            } else if (current.close <= lowerBand && rsi <= 30) {
                direction = 'UP';
            }

            if (direction) {
                inTrade = true;
                tradeType = direction;
                entryPrice = current.close;
                trades++;
            }
        } else {
            // Gestión de salida (usamos precios de velas para simular)
            let highChangePct = (current.high - entryPrice) / entryPrice;
            let lowChangePct = (current.low - entryPrice) / entryPrice;

            if (tradeType === 'DOWN') {
                highChangePct = -((current.low - entryPrice) / entryPrice);
                lowChangePct = -((current.high - entryPrice) / entryPrice);
            }

            const maxProfit = highChangePct * CONFIG.multiplier * CONFIG.stake;
            const maxLoss = lowChangePct * CONFIG.multiplier * CONFIG.stake;

            // Primero verificamos si tocó el SL (pesimismo del backtest)
            if (maxLoss <= -CONFIG.stopLoss) {
                balance -= CONFIG.stopLoss;
                losses++;
                inTrade = false;
            } else if (maxProfit >= CONFIG.takeProfit) {
                balance += CONFIG.takeProfit;
                wins++;
                inTrade = false;
            }
        }
    }

    console.log("\n=========================================");
    console.log("📅 RESULTADO SEMANAL ORO: BOLLINGER + RSI");
    console.log("=========================================");
    console.log(`PnL Total de la Semana: $${balance.toFixed(2)}`);
    console.log(`Win Rate: ${((wins / (trades || 1)) * 100).toFixed(1)}%`);
    console.log(`Ganadas: ${wins} | Perdidas: ${losses}`);
    console.log(`Total Trades: ${trades}`);
    console.log(`Promedio Trades/Día: ${(trades / 5).toFixed(1)}`);
    console.log("=========================================\n");
}
