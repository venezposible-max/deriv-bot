const WebSocket = require('ws');
const APP_ID = 1089;
const SYMBOL = 'R_100';

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
let allCandles = [];
const TOTAL_CANDLES_NEEDED = 35000; // ~24 días (un mes de mercado aprox)

ws.on('open', () => {
    console.log("📥 Descargando DATA maestra para optimización (35k velas)...");
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
            runMasterOptimization();
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

function runSimulation(ticks, candles, config) {
    let balance = 0, wins = 0, losses = 0, trades = 0;
    let inTrade = false, entryPrice = 0, tradeType = null, currentMaxProfit = 0, lastSlAssigned = -100;

    for (let i = 250; i < candles.length; i++) {
        const c = candles[i];
        let signal = null;

        const lastCloses = ticks.slice(i - config.mom, i);
        const allUp = lastCloses.every((v, idx) => idx === 0 || v > lastCloses[idx - 1]);
        const allDown = lastCloses.every((v, idx) => idx === 0 || v < lastCloses[idx - 1]);

        if (allUp || allDown) {
            const sma50 = calculateSMA(ticks.slice(0, i), 50);
            const smaL = calculateSMA(ticks.slice(0, i), config.sma);
            const rsi = calculateRSI(ticks.slice(0, i), 14);
            const atr = calculateATR(candles.slice(0, i), 14);

            if (c.high - c.low < atr * 0.7) continue;

            if (sma50 && smaL && rsi) {
                const dist = Math.abs(c.close - sma50) / sma50 * 100;
                if (dist < 0.08) {
                    if (allUp && c.close > smaL && rsi > 45) signal = 'UP';
                    if (allDown && c.close < smaL && rsi < 55) signal = 'DOWN';
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

                if (currentMaxProfit >= 0.5) {
                    let floor = (Math.floor(currentMaxProfit / 0.5) * 0.5) - config.tdist;
                    if (floor > lastSlAssigned) lastSlAssigned = floor;
                }

                if (prof <= -config.sl) { balance -= config.sl; losses++; inTrade = false; break; }
                if (prof >= config.tp) { balance += config.tp; wins++; inTrade = false; break; }
                if (lastSlAssigned > -99 && prof <= lastSlAssigned) {
                    balance += lastSlAssigned; if (lastSlAssigned > 0) wins++; else losses++; inTrade = false; break;
                }
            }
            if (inTrade && signal && signal !== tradeType) {
                let diff = (c.close - entryPrice) / entryPrice;
                if (tradeType === 'DOWN') diff = -diff;
                let prof = diff * 40 * 20;
                balance += prof; if (prof > 0) wins++; else losses++;
                inTrade = false; // El reverso se activará en el siguiente tick o manual si se desea
            }
        } else if (signal) {
            inTrade = true; tradeType = signal; entryPrice = c.close; currentMaxProfit = 0; lastSlAssigned = -100; trades++;
        }
    }
    return { pnl: balance, wr: (wins / (trades || 1)) * 100, t: trades };
}

function runMasterOptimization() {
    const ticks = allCandles.map(c => c.close);
    const results = [];

    // RANGOS DE BUSQUEDA MAESTRA
    const TPs = [3, 5, 8];
    const SLs = [1.5, 3, 5];
    const MOMs = [5, 7, 9];
    const SMAs = [100, 150, 200];
    const TDISTs = [0.5, 0.7, 1.0];

    console.log("🛠️ OPTIMIZACIÓN MAESTRA INICIADA (Miles de combinaciones)...");

    for (let tp of TPs) {
        for (let sl of SLs) {
            for (let mom of MOMs) {
                for (let sma of SMAs) {
                    for (let td of TDISTs) {
                        const config = { tp, sl, mom, sma, tdist: td };
                        const res = runSimulation(ticks, allCandles, config);
                        if (res.pnl > 0 && res.t > 15) {
                            results.push({ config, res });
                        }
                    }
                }
            }
        }
    }

    results.sort((a, b) => b.res.pnl - a.res.pnl);

    console.log("\n🏆 LAS 5 TÉCNICAS MÁS RENTABLES DEL ÚLTIMO MES:");
    results.slice(0, 5).forEach((r, i) => {
        console.log(`\nRANK #${i + 1}: PnL: $${r.res.pnl.toFixed(2)} | WinRate: ${r.res.wr.toFixed(1)}% | Trades: ${r.res.t}`);
        console.log(`Config: TP: ${r.config.tp} | SL: ${r.config.sl} | Mom: ${r.config.mom} | SMA: ${r.config.sma} | TrailDist: ${r.config.tdist}`);
    });
}
