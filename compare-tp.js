const WebSocket = require('ws');
const APP_ID = 1089;
const SYMBOL = 'R_100';

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
let allCandles = [];
const TOTAL_CANDLES_NEEDED = 10000; // ~7 días para una comparación real

ws.on('open', () => {
    console.log("📥 Descargando DATA para COMPARATIVA (7 días)...");
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
            console.log(`\n✅ DATA OK: ${allCandles.length} velas.`);
            runComparison();
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

function runSimulation(candles, tpValue) {
    const closes = candles.map(c => c.close);
    let balance = 0, wins = 0, losses = 0, trades = 0;
    let inTrade = false, entryPrice = 0, tradeType = null, currentMaxProfit = 0, lastSlAssigned = -100;

    for (let i = 200; i < candles.length; i++) {
        const c = candles[i];
        let signal = null;

        const lastCloses = closes.slice(i - 5, i);
        const allUp = lastCloses.every((v, idx) => idx === 0 || v > lastCloses[idx - 1]);
        const allDown = lastCloses.every((v, idx) => idx === 0 || v < lastCloses[idx - 1]);

        if (allUp || allDown) {
            const sma50 = calculateSMA(closes.slice(0, i), 50);
            const sma200 = calculateSMA(closes.slice(0, i), 200);
            const rsi = calculateRSI(closes.slice(0, i), 14);

            if (sma50 && sma200 && rsi) {
                const dist = Math.abs(c.close - sma50) / sma50 * 100;
                if (dist < 0.08) {
                    if (allUp && c.close > sma200 && rsi > 45) signal = 'UP';
                    if (allDown && c.close < sma200 && rsi < 55) signal = 'DOWN';
                }
            }
        }

        if (inTrade) {
            const prices = [c.open, c.high, c.low, c.close];
            for (let p of prices) {
                let diff = (p - entryPrice) / entryPrice;
                if (tradeType === 'DOWN') diff = -diff;
                let prof = diff * 40 * 20;
                if (prof > currentMaxProfit) currentMaxProfit = prof;

                // TRAILING STOP DE 0.50
                if (currentMaxProfit >= 0.5) {
                    let floor = (Math.floor(currentMaxProfit / 0.5) * 0.5) - 0.5;
                    if (floor > lastSlAssigned) lastSlAssigned = floor;
                }

                if (prof <= -1.5) { balance -= 1.5; losses++; inTrade = false; break; }
                if (prof >= tpValue) { balance += tpValue; wins++; inTrade = false; break; }
                if (lastSlAssigned > -99 && prof <= lastSlAssigned) {
                    balance += lastSlAssigned; if (lastSlAssigned > 0) wins++; else losses++; inTrade = false; break;
                }
            }
        } else if (signal) {
            inTrade = true; tradeType = signal; entryPrice = c.close; currentMaxProfit = 0; lastSlAssigned = -100; trades++;
        }
    }
    return { pnl: balance, wr: (wins / (trades || 1)) * 100, t: trades };
}

function runComparison() {
    console.log("\n🧪 INICIANDO COMPARATIVA TÉCNICA (7 DÍAS)");
    console.log("-----------------------------------------");

    const res3 = runSimulation(allCandles, 3.0);
    const res10 = runSimulation(allCandles, 10.0);

    console.log(`\nOPCIÓN A: TP FIJO $3.00 (+ Trailing 0.5)`);
    console.log(`PnL: $${res3.pnl.toFixed(2)} | WinRate: ${res3.wr.toFixed(1)}% | Trades: ${res3.t}`);

    console.log(`\nOPCIÓN B: TP LARGO $10.00 (+ Trailing 0.5)`);
    console.log(`PnL: $${res10.pnl.toFixed(2)} | WinRate: ${res10.wr.toFixed(1)}% | Trades: ${res10.t}`);

    console.log("\n-----------------------------------------");
    if (res3.pnl > res10.pnl) {
        console.log("💡 RESULTADO: El TP de $3 es mejor porque 'asegura' la ganancia antes de que el mercado se regrese.");
    } else {
        console.log("💡 RESULTADO: El TP de $10 es mejor porque permite capturar tendencias largas.");
    }
}
