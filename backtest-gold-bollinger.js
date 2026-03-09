const WebSocket = require('ws');
const APP_ID = 1089;
const SYMBOL = 'frxXAUUSD';

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
let allTicks = [];
const TOTAL_TICKS_NEEDED = 15000; // Pedimos más data para tener mejores promedios

ws.on('open', () => {
    console.log(`\n📥 BUSCANDO LA "LLAVE MAESTRA" DEL ORO (XAUUSD)...`);
    console.log(`🧠 Probando Estrategia: "REVERSIÓN DE BANDAS (BOLLINGER + RSI)"`);
    fetchTicks();
});

function fetchTicks(beforeEpoch = 'latest') {
    ws.send(JSON.stringify({ ticks_history: SYMBOL, end: beforeEpoch || 'latest', count: 5000, style: 'ticks' }));
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
            console.log(`\n✅ DATA CARGADA (${allTicks.length} ticks).`);
            runGoldProBacktest();
            ws.close();
        }
    }
});

// --- INDICADORES ---
function calculateSMA(p, n) { if (p.length < n) return null; return p.slice(-n).reduce((a, b) => a + b, 0) / n; }

function calculateStdDev(p, n, sma) {
    if (p.length < n) return null;
    const sqDiffs = p.slice(-n).map(v => Math.pow(v - sma, 2));
    const avgSqDiff = sqDiffs.reduce((a, b) => a + b, 0) / n;
    return Math.sqrt(avgSqDiff);
}

function calculateRSI(prices, period) {
    if (prices.length < period + 1) return 50;
    let gains = 0, losses = 0;
    for (let i = prices.length - period; i < prices.length; i++) {
        let diff = prices[i] - prices[i - 1];
        if (diff >= 0) gains += diff; else losses -= diff;
    }
    let rs = (gains / period) / (losses / period || 1);
    return 100 - (100 / (1 + rs));
}

function runGoldProBacktest() {
    let balance = 0, wins = 0, losses = 0, trades = 0;
    let inTrade = false, entryPrice = 0, tradeType = null;

    const BB_PERIOD = 20;
    const BB_STDDEV = 2.0;

    for (let i = 100; i < allTicks.length - 100; i++) {
        const quote = allTicks[i];

        if (!inTrade) {
            const sma = calculateSMA(allTicks.slice(0, i), BB_PERIOD);
            const stdDev = calculateStdDev(allTicks.slice(0, i), BB_PERIOD, sma);
            const rsi = calculateRSI(allTicks.slice(i - 100, i), 14);

            if (!sma || !stdDev) continue;

            const upperBand = sma + (BB_STDDEV * stdDev);
            const lowerBand = sma - (BB_STDDEV * stdDev);

            let direction = null;

            // LÓGICA REVERSIÓN EXTREMA:
            // 1. Toca la banda exterior (Precio estirado)
            // 2. RSI está en zona de agotamiento (Sobre-extendido)
            if (quote >= upperBand && rsi >= 70) {
                direction = 'DOWN'; // Esperamos que vuelva a la media
            } else if (quote <= lowerBand && rsi <= 30) {
                direction = 'UP'; // Esperamos rebote
            }

            if (direction) {
                inTrade = true;
                tradeType = direction;
                entryPrice = allTicks[i + 1]; // Latencia mínima
                trades++;
                i += 20;
            }
        } else {
            let priceChangePct = (quote - entryPrice) / entryPrice;
            if (tradeType === 'DOWN') priceChangePct = -priceChangePct;

            // Oro es más lento, TP de 2% y SL de 4% (Martingala suave no, gestión fija)
            const profit = priceChangePct * 500 * 20; // Multiplier 500, Stake 20

            if (profit >= 3.00) { // Take Profit de $3
                balance += 3.00; wins++; inTrade = false; i += 50;
            } else if (profit <= -4.00) { // Stop Loss de $4
                balance -= 4.00; losses++; inTrade = false; i += 50;
            }
        }
    }

    console.log("\n=========================================");
    console.log("🕵️‍♂️ ESTRATEGIA: GOLD REVERSIÓN (BB + RSI)");
    console.log("=========================================");
    console.log(`PnL Neto ($): ${balance.toFixed(2)}`);
    console.log(`Win Rate: ${((wins / (trades || 1)) * 100).toFixed(1)}%`);
    console.log(`Ganadas: ${wins} | Perdidas: ${losses}`);
    console.log(`Total Trades: ${trades}`);
    console.log("=========================================\n");
}
