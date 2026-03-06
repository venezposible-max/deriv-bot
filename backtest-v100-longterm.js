const WebSocket = require('ws');
const APP_ID = 1089;
const SYMBOL = 'R_100';

const CONFIG = {
    stake: 20,
    takeProfit: 3.0,    // Valor óptimo encontrado
    multiplier: 40,
    momentum: 5,        // Frecuencia optimizada
    stopLoss: 1.5,      // Ratio 2:1 contra el TP
    trailStart: 0.5,
    trailDist: 0.5,     // Protección ajustada
    trailStep: 0.5,
    smaPeriod: 50,
    smaLongPeriod: 200, // Filtro de tendencia mayor (SMA200)
    rsiPeriod: 14,
    atrPeriod: 14
};

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
let allCandles = [];
const TOTAL_CANDLES_NEEDED = 1000; // Analizaremos las últimas ~16 horas para evaluar las últimas 12h operativas

ws.on('open', () => {
    console.log("📥 Descargando historial de 1 mes (en trozos)...");
    fetchChunk();
});

function fetchChunk(beforeEpoch = 'latest') {
    ws.send(JSON.stringify({
        ticks_history: SYMBOL,
        end: beforeEpoch || 'latest',
        count: 5000,
        granularity: 60,
        style: 'candles'
    }));
}

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.msg_type === 'candles') {
        const chunk = msg.candles || [];
        allCandles = [...chunk, ...allCandles];

        if (allCandles.length < TOTAL_CANDLES_NEEDED && chunk.length > 0) {
            process.stdout.write('.');
            fetchChunk(chunk[0].epoch);
        } else {
            console.log(`\n✅ Historial Cargado: ${allCandles.length} velas M1 (~${(allCandles.length / 1440).toFixed(1)} días).`);
            runSimulation();
            ws.close();
        }
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
    if (losses === 0) return 100;
    let rs = (gains / period) / (losses / period);
    return 100 - (100 / (1 + rs));
}

function calculateATR(candles, period = 14) {
    if (candles.length < period) return 0;
    let sum = 0;
    for (let i = candles.length - period; i < candles.length; i++) {
        sum += (candles[i].high - candles[i].low);
    }
    return sum / period;
}

function runSimulation() {
    let balance = 0;
    let totalTrades = 0;
    let wins = 0;
    let losses = 0;
    let inTrade = false;
    let entryPrice = 0;
    let tradeType = null;
    let currentMaxProfit = 0;
    let lastSlAssigned = -100;

    const closes = allCandles.map(c => c.close);

    console.log(`\n📊 Iniciando Simulación TÉCNICA MAESTRA (Últimas 12h)...`);
    console.log(`Config: TP $3 | SL $1.5 | Mom 5 | SMA 200`);

    for (let i = 200; i < allCandles.length; i++) {
        const c = allCandles[i];

        let signal = null;
        const lastCloses = closes.slice(i - CONFIG.momentum, i);
        const allUp = lastCloses.every((v, idx) => idx === 0 || v > lastCloses[idx - 1]);
        const allDown = lastCloses.every((v, idx) => idx === 0 || v < lastCloses[idx - 1]);

        if (allUp || allDown) {
            const sma50 = calculateSMA(closes.slice(0, i), CONFIG.smaPeriod);
            const sma100 = calculateSMA(closes.slice(0, i), CONFIG.smaLongPeriod);
            const rsi = calculateRSI(closes.slice(0, i), CONFIG.rsiPeriod);
            const atr = calculateATR(allCandles.slice(0, i), CONFIG.atrPeriod);

            // Filtro Volatilidad RELAJADO
            const candleRange = c.high - c.low;
            if (candleRange < atr * 0.6) continue;

            if (sma50 && sma100 && rsi) {
                const distPct = Math.abs(c.close - sma50) / sma50 * 100;

                // --- SEÑAL MAESTRA ---
                if (distPct < 0.08) {
                    if (allUp && c.close > sma100 && rsi > 45) signal = 'MULTUP';
                    if (allDown && c.close < sma100 && rsi < 55) signal = 'MULTDOWN';
                }
            }
        }

        if (inTrade) {
            const prices = [c.open, c.high, c.low, c.close];
            for (let p of prices) {
                let priceChangePct = (p - entryPrice) / entryPrice;
                if (tradeType === 'MULTDOWN') priceChangePct = -priceChangePct;
                let currentProfit = priceChangePct * CONFIG.multiplier * CONFIG.stake;
                if (currentProfit > currentMaxProfit) currentMaxProfit = currentProfit;

                if (currentMaxProfit >= CONFIG.trailStart) {
                    const step = Math.floor(currentMaxProfit / CONFIG.trailStep) * CONFIG.trailStep;
                    const floor = step - CONFIG.trailDist;
                    if (floor > lastSlAssigned) lastSlAssigned = floor;
                }

                if (currentProfit <= -CONFIG.stopLoss) {
                    balance -= CONFIG.stopLoss; losses++; inTrade = false; break;
                } else if (currentProfit >= CONFIG.takeProfit) {
                    balance += CONFIG.takeProfit; wins++; inTrade = false; break;
                } else if (lastSlAssigned > -99 && currentProfit <= lastSlAssigned) {
                    balance += lastSlAssigned; if (lastSlAssigned > 0) wins++; else losses++; inTrade = false; break;
                }
            }
            if (inTrade && signal && signal !== tradeType) {
                let priceChangePct = (c.close - entryPrice) / entryPrice;
                if (tradeType === 'MULTDOWN') priceChangePct = -priceChangePct;
                let finalProfit = priceChangePct * CONFIG.multiplier * CONFIG.stake;
                balance += finalProfit;
                if (finalProfit > 0) wins++; else losses++;
                tradeType = signal; entryPrice = c.close; currentMaxProfit = 0; lastSlAssigned = -100; totalTrades++;
            }
        } else if (signal) {
            inTrade = true;
            tradeType = signal;
            entryPrice = c.close;
            currentMaxProfit = 0;
            lastSlAssigned = -100;
            totalTrades++;
        }
    }

    console.log(`\n====================================================`);
    console.log(`🏆 RESULTADO FINAL ESTIMADO (3 SEMANAS REFINADO)`);
    console.log(`====================================================`);
    console.log(`Días analizados: ${(allCandles.length / 1440).toFixed(1)}`);
    console.log(`Total Trades: ${totalTrades}`);
    console.log(`Ganadas: ${wins} ✅`);
    console.log(`Perdidas: ${losses} ❌`);
    console.log(`PnL Acumulado: $${balance.toFixed(2)} 💰`);
    console.log(`Rendimiento Mensual Proyectado (30d): $${((balance / (allCandles.length / 1440)) * 30).toFixed(2)}`);
    console.log(`====================================================\n`);
}
