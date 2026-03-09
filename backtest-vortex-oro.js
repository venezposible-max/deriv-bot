const WebSocket = require('ws');
const APP_ID = 1089;
const SYMBOL = 'frxXAUUSD';

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
let allTicks = [];
const TOTAL_TICKS_NEEDED = 10000; // El oro tiene menos ticks, pedimos más historial

const CONFIG = {
    stake: 20,
    takeProfit: 2.00,
    stopLoss: 3.00,
    multiplier: 500, // Multiplicador estándar para Oro en Deriv
    latency: 1
};

ws.on('open', () => {
    console.log(`\n📥 EJECUTANDO VORTEX 3-5 EN ORO (frxXAUUSD)...`);
    console.log(`🧠 Filtros: Volatilidad Algorítmica + MACD + RSI Anti-Techo...`);
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
            console.log(`\n✅ DATA CARGADA (${allTicks.length} ticks). Iniciando procesamiento...`);
            runVortexBacktest();
            ws.close();
        }
    }
});

function calculateEMA(prices, period) {
    if (prices.length < period) return null;
    let k = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < prices.length; i++) ema = (prices[i] * k) + (ema * (1 - k));
    return ema;
}

function calculateSMA(prices, period) {
    if (prices.length < period) return null;
    return prices.slice(-period).reduce((a, b) => a + b, 0) / period;
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

function getMACD(prices) {
    if (prices.length < 60) return null;
    const ema12 = calculateEMA(prices, 12);
    const ema26 = calculateEMA(prices, 26);
    if (ema12 === null || ema26 === null) return null;
    const currentMacd = ema12 - ema26;
    const prevEma12 = calculateEMA(prices.slice(0, -1), 12);
    const prevEma26 = calculateEMA(prices.slice(0, -1), 26);
    const prevMacd = (prevEma12 !== null && prevEma26 !== null) ? (prevEma12 - prevEma26) : null;
    return { current: currentMacd, prev: prevMacd };
}

function runVortexBacktest() {
    let balance = 0, wins = 0, losses = 0, trades = 0;
    let inTrade = false, entryPrice = 0, tradeType = null;
    const SMA_LONG = 500; // En oro los movimientos son más lentos, bajamos la ventana de tendencia

    for (let i = SMA_LONG; i < allTicks.length - 100; i++) {
        const quote = allTicks[i];

        if (!inTrade) {
            const trend = calculateSMA(allTicks.slice(0, i), SMA_LONG);
            if (!trend) continue;

            const move3 = Math.abs(allTicks[i] - allTicks[i - 3]);
            let sumPrevDiffs = 0;
            for (let j = i - 12; j < i - 3; j++) sumPrevDiffs += Math.abs(allTicks[j] - allTicks[j - 1]);
            const avgMove10 = sumPrevDiffs / 10;

            // Oro tiene menos volatilidad que Step Index, bajamos el umbral
            const isExplosion = move3 > (avgMove10 * 1.8);

            const rsi7 = calculateRSI(allTicks.slice(i - 40, i), 7);
            const macd = getMACD(allTicks.slice(0, i));

            let direction = null;
            const last3 = allTicks.slice(i - 3, i);
            const allUp = last3.every((v, k) => k === 0 || v > last3[k - 1]);
            const allDown = last3.every((v, k) => k === 0 || v < last3[k - 1]);

            if (isExplosion && macd && macd.prev !== null) {
                if (allUp && quote > trend && macd.current > macd.prev && rsi7 < 80) direction = 'UP';
                else if (allDown && quote < trend && macd.current < macd.prev && rsi7 > 20) direction = 'DOWN';
            }

            if (direction) {
                inTrade = true;
                tradeType = direction;
                entryPrice = allTicks[i + CONFIG.latency];
                trades++;
                i += CONFIG.latency;
            }
        } else {
            let priceChangePct = (quote - entryPrice) / entryPrice;
            if (tradeType === 'DOWN') priceChangePct = -priceChangePct;
            const profit = priceChangePct * CONFIG.multiplier * CONFIG.stake;

            if (profit >= CONFIG.takeProfit) {
                balance += CONFIG.takeProfit;
                wins++;
                inTrade = false;
                i += 10; // Cooldown
            } else if (profit <= -CONFIG.stopLoss) {
                balance -= CONFIG.stopLoss;
                losses++;
                inTrade = false;
                i += 10;
            }
        }
    }

    console.log("\n=========================================");
    console.log("🕵️‍♂️ RESULTADO VORTEX 3-5 : ORO (XAUUSD)");
    console.log("=========================================");
    console.log(`PnL Neto ($): ${balance.toFixed(2)}`);
    console.log(`Win Rate: ${((wins / (trades || 1)) * 100).toFixed(1)}%`);
    console.log(`Ganadas: ${wins} | Perdidas: ${losses}`);
    console.log(`Total Trades: ${trades}`);
    console.log("=========================================\n");
}
