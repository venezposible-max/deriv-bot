const WebSocket = require('ws');
const APP_ID = 1089;
const SYMBOL = 'stpRNG';

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
let allTicks = [];
const TOTAL_TICKS_NEEDED = 50000;

const SNIPER_CONFIG = {
    stake: 20,
    takeProfit: 2.00,  // 🎯 Bajamos TP para mayor frecuencia de cobro
    stopLoss: 3.00,    // 🛡️ Subimos SL para dar más respiro (Modo Vortex Original)
    multiplier: 750,
    momentum: 5,
    distLimit: 0.12    // 🎯 Un poco más de libertad para el Vortex
};

ws.on('open', () => {
    console.log(`\n📥 EJECUTANDO PRUEBA DE "EQUILIBRIO VORTEX": STEP INDEX...`);
    console.log(`🧠 Configuración Propuesta: TP: $${SNIPER_CONFIG.takeProfit} | SL: $${SNIPER_CONFIG.stopLoss} (Ratio balanceado)`);
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
            console.log(`\n✅ DATA CARGADA. Iniciando comparativa...`);
            runVortexBacktest();
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

function calculateEMA(prices, period) {
    if (prices.length < period) return null;
    let k = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < prices.length; i++) ema = (prices[i] * k) + (ema * (1 - k));
    return ema;
}

function calculateRSI(prices, period) {
    if (prices.length < period + 1) return 50;
    let gains = 0, losses = 0;
    for (let i = prices.length - period; i < prices.length; i++) {
        let diff = prices[i] - prices[i - 1];
        if (diff >= 0) gains += diff; else losses -= diff;
    }
    let rsc = (gains / period) / (losses / period || 1);
    return 100 - (100 / (1 + rsc));
}

function getMACD(prices) {
    if (prices.length < 40) return null;
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

    for (let i = 2000; i < allTicks.length - 100; i++) {
        const quote = allTicks[i];
        if (!inTrade) {
            const trendVortex = calculateSMA(allTicks.slice(0, i + 1), 2000);
            const rsi7 = calculateRSI(allTicks.slice(0, i + 1), 7);
            const macd = getMACD(allTicks.slice(0, i + 1));
            if (!trendVortex || !macd) continue;
            const distPct = Math.abs(quote - trendVortex) / trendVortex * 100;
            const lastTicks = allTicks.slice(i - SNIPER_CONFIG.momentum + 1, i + 1);
            const allUp = lastTicks.every((v, k) => k === 0 || v > lastTicks[k - 1]);
            const allDown = lastTicks.every((v, k) => k === 0 || v < lastTicks[k - 1]);
            const move3 = Math.abs(allTicks[i] - allTicks[i - 3]);
            let sumPrevDiffs = 0;
            for (let j = i - 12; j < i - 3; j++) sumPrevDiffs += Math.abs(allTicks[j + 1] - allTicks[j]);
            const avgMove10 = sumPrevDiffs / 9;
            const isExplosion = move3 > (avgMove10 * 2.5);

            let direction = null;
            if (isExplosion && distPct < SNIPER_CONFIG.distLimit) {
                if (allUp && quote > trendVortex && macd.current > (macd.prev || 0) && rsi7 < 80) direction = 'UP';
                if (allDown && quote < trendVortex && macd.current < (macd.prev || 0) && rsi7 > 20) direction = 'DOWN';
            }

            if (direction) {
                inTrade = true; tradeType = direction; entryPrice = allTicks[i + 1]; trades++;
            }
        } else {
            let priceChangePct = (quote - entryPrice) / entryPrice;
            if (tradeType === 'DOWN') priceChangePct = -priceChangePct;
            const profit = priceChangePct * SNIPER_CONFIG.multiplier * SNIPER_CONFIG.stake;
            if (profit >= SNIPER_CONFIG.takeProfit) {
                balance += SNIPER_CONFIG.takeProfit; wins++; inTrade = false; i += 30;
            } else if (profit <= -SNIPER_CONFIG.stopLoss) {
                balance -= SNIPER_CONFIG.stopLoss; losses++; inTrade = false; i += 30;
            }
        }
    }
    console.log("\n=========================================");
    console.log("🕵️‍♂️ RESULTADO PRUEBA: EQUILIBRIO VORTEX");
    console.log("=========================================");
    console.log(`PnL Neto ($): ${balance.toFixed(2)}`);
    console.log(`Win Rate: ${((wins / (trades || 1)) * 100).toFixed(1)}%`);
    console.log(`Ganadas: ${wins} | Perdidas: ${losses}`);
    console.log(`Total Trades: ${trades}`);
    console.log("=========================================\n");
}
