const WebSocket = require('ws');
const APP_ID = 1089;
const SYMBOL = 'R_100';

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
let allPrices = [];
let allTimes = [];
const TARGET_TICKS = 10000; // Analizaremos exactamente las últimas 6 horas de mercado

ws.on('open', () => {
    fetchHistory();
});

function fetchHistory(beforeEpoch = null) {
    const request = {
        ticks_history: SYMBOL,
        adjust_start_time: 1,
        count: 5000,
        end: beforeEpoch || 'latest',
        style: 'ticks'
    };
    ws.send(JSON.stringify(request));
}

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.msg_type === 'history') {
        allPrices = [...msg.history.prices, ...allPrices];
        allTimes = [...msg.history.times, ...allTimes];

        if (allPrices.length < TARGET_TICKS) {
            process.stdout.write('.');
            fetchHistory(msg.history.times[0]);
        } else {
            console.log(`\n📊 DATA OK: ${allPrices.length} ticks.`);
            optimize();
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
    let aveGain = gains / period;
    let aveLoss = losses / period;
    if (aveLoss === 0) return 100;
    let rs = aveGain / aveLoss;
    return 100 - (100 / (1 + rs));
}

function runSimulation(ticks, config) {
    let balance = 0;
    let totalTrades = 0;
    let wins = 0;
    let losses = 0;
    let inTrade = false;
    let entryPrice = 0;
    let tradeType = null;
    let currentMaxProfit = 0;
    let lastSlAssigned = -100;

    for (let i = 100; i < ticks.length; i++) {
        const currentPrice = ticks[i];

        // Señal
        let signal = null;
        let lastTicks = ticks.slice(i - config.momentum, i);
        const allDown = lastTicks.every((v, idx) => idx === 0 || v < lastTicks[idx - 1]);
        const allUp = lastTicks.every((v, idx) => idx === 0 || v > lastTicks[idx - 1]);

        if (allUp || allDown) {
            const sma = calculateSMA(ticks.slice(0, i), config.smaPeriod);
            const rsi = calculateRSI(ticks.slice(0, i), config.rsiPeriod);
            if (sma && rsi) {
                const distPct = Math.abs(currentPrice - sma) / sma * 100;
                // SNIPER refined
                if (distPct < 0.08 && rsi >= 45 && rsi <= 55) {
                    signal = allUp ? 'MULTUP' : 'MULTDOWN';
                }
                // DYNAMIC refined
                else if (distPct > 0.15) {
                    if (allUp && rsi > 70) signal = 'MULTDOWN';
                    else if (allDown && rsi < 30) signal = 'MULTUP';
                }
            }
        }

        if (inTrade) {
            let priceChangePct = (currentPrice - entryPrice) / entryPrice;
            if (tradeType === 'MULTDOWN') priceChangePct = -priceChangePct;
            let currentProfit = priceChangePct * config.multiplier * config.stake;
            if (currentProfit > currentMaxProfit) currentMaxProfit = currentProfit;

            // Trailing Stop CONFIGURABLE
            if (currentMaxProfit >= config.trailStart) {
                const step = Math.floor(currentMaxProfit / config.trailStep) * config.trailStep;
                const floor = step - config.trailDist;
                if (floor > lastSlAssigned) lastSlAssigned = floor;
            }

            let exit = false;
            if (currentProfit <= -config.stopLoss) exit = true;
            else if (currentProfit >= config.takeProfit) exit = true;
            else if (lastSlAssigned > -99 && currentProfit <= lastSlAssigned) exit = true;
            // Stop & Reverse
            else if (signal && signal !== tradeType) exit = true;

            if (exit) {
                if (currentProfit > 0) wins++; else losses++;
                balance += (currentProfit <= -config.stopLoss ? -config.stopLoss : currentProfit);
                inTrade = false;
                if (signal && signal !== tradeType) {
                    // Reverse
                    inTrade = true;
                    tradeType = signal;
                    entryPrice = currentPrice;
                    currentMaxProfit = 0;
                    lastSlAssigned = -100;
                    totalTrades++;
                }
            }
        } else if (signal) {
            inTrade = true;
            tradeType = signal;
            entryPrice = currentPrice;
            currentMaxProfit = 0;
            lastSlAssigned = -100;
            totalTrades++;
        }
    }
    return { pnl: balance, winRate: (wins / (totalTrades || 1)) * 100, trades: totalTrades };
}

function optimize() {
    const results = [];
    const stakes = [20];
    const momentums = [5, 7, 9];
    const stopLosses = [1, 3, 5];
    const trailDists = [0.3, 0.5, 0.7];
    const trailSteps = [0.3, 0.5];

    console.log("🚀 Iniciando Optimización Intensiva...");

    for (let mom of momentums) {
        for (let sl of stopLosses) {
            for (let td of trailDists) {
                for (let ts of trailSteps) {
                    const config = {
                        stake: 20,
                        takeProfit: 5, // TP más corto para este mercado
                        multiplier: 40,
                        momentum: mom,
                        stopLoss: sl,
                        smaPeriod: 50,
                        rsiPeriod: 14,
                        trailStart: 0.5,
                        trailStep: ts,
                        trailDist: td
                    };
                    const res = runSimulation(allPrices, config);
                    results.push({ config, res });
                }
            }
        }
    }

    results.sort((a, b) => b.res.pnl - a.res.pnl);

    console.log("\n🏆 TOP 3 ESTRATEGIAS MÁS RENTABLES:");
    results.slice(0, 3).forEach((r, i) => {
        console.log(`\nRANK #${i + 1}: PnL: $${r.res.pnl.toFixed(2)} | WinRate: ${r.res.winRate.toFixed(1)}% | Trades: ${r.res.trades}`);
        console.log(`Config: Mom: ${r.config.momentum} | SL: ${r.config.stopLoss} | TP: ${r.config.takeProfit} | TrailDist: ${r.config.trailDist} | TrailStep: ${r.config.trailStep}`);
    });
}
