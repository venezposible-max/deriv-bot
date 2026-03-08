const WebSocket = require('ws');
const APP_ID = 1089;
const SYMBOL = 'R_100';

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
let allTicks = [];
const TOTAL_TICKS_NEEDED = 80000; // ~24 horas

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
    console.log(`📥 Descargando DATA TICKS para COMPARATIVA HÍBRIDA (24H)...`);
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
            console.log(`\n✅ DATA CARGADA: ${allTicks.length} ticks.`);
            runComparison();
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

function runSimulation(useHybrid) {
    let balance = 0, wins = 0, losses = 0, trades = 0;
    let inTrade = false, entryPrice = 0, tradeType = null, maxProfit = 0, lastSl = -100;

    for (let i = 250; i < allTicks.length; i++) {
        const quote = allTicks[i];
        const last5 = allTicks.slice(i - CONFIG.momentum, i);
        const allUp = last5.every((v, j) => j === 0 || v > last5[j - 1]);
        const allDown = last5.every((v, j) => j === 0 || v < last5[j - 1]);

        if (!inTrade) {
            const sma50 = calculateSMA(allTicks.slice(0, i), CONFIG.smaPeriod);
            const sma200 = calculateSMA(allTicks.slice(0, i), CONFIG.smaLongPeriod);
            const rsi = calculateRSI(allTicks.slice(0, i), 14);

            if (sma50 && sma200 && rsi) {
                let signal = null;
                const distPct = Math.abs(quote - sma50) / sma50 * 100;

                if (useHybrid) {
                    // MODO HÍBRIDO (Sniper + Alpha)
                    if (distPct < 0.10 && rsi >= 40 && rsi <= 60) {
                        if (allUp) signal = 'UP';
                        if (allDown) signal = 'DOWN';
                    } else if (distPct > 0.20) {
                        if (allUp && rsi > 75) signal = 'DOWN'; // Reversión
                        if (allDown && rsi < 25) signal = 'UP';    // Reversión
                    }
                } else {
                    // MODO ESTÁNDAR AGRESIVO (El que tienes ahora)
                    if (allUp && quote > sma200 && rsi > 45) signal = 'UP';
                    if (allDown && quote < sma200 && rsi < 55) signal = 'DOWN';
                }

                if (signal) {
                    inTrade = true; tradeType = signal; entryPrice = quote; maxProfit = 0; lastSl = -100; trades++;
                }
            }
        } else {
            let diff = (quote - entryPrice) / entryPrice;
            if (tradeType === 'DOWN') diff = -diff;
            let prof = diff * CONFIG.multiplier * CONFIG.stake;
            if (prof > maxProfit) maxProfit = prof;

            if (maxProfit >= CONFIG.trailStart) {
                let floor = (Math.floor(maxProfit / 0.1) * 0.1) - CONFIG.trailDist;
                if (floor > lastSl) lastSl = floor;
            }

            if (prof <= -CONFIG.stopLoss) {
                balance -= CONFIG.stopLoss; losses++; inTrade = false;
            } else if (prof >= CONFIG.takeProfit) {
                balance += CONFIG.takeProfit; wins++; inTrade = false;
            } else if (lastSl > -99 && prof <= lastSl) {
                balance += lastSl; if (lastSl > 0) wins++; else losses++; inTrade = false;
            }
        }
    }
    return { balance, wins, losses, trades };
}

function runComparison() {
    console.log(`\n🧪 INICIANDO COMPARATIVA TÉCNICA (24 HORAS TICKS)`);
    console.log(`-----------------------------------------------`);

    const standard = runSimulation(false);
    const hybrid = runSimulation(true);

    console.log(`\nOPCIÓN A: MODO ESTÁNDAR (Actual Agresivo)`);
    console.log(`PnL: $${standard.balance.toFixed(2)} | Wins: ${standard.wins} | Losses: ${standard.losses} | Trades: ${standard.trades}`);

    console.log(`\nOPCIÓN B: MODO HÍBRIDO (Sniper + Alpha Mode)`);
    console.log(`PnL: $${hybrid.balance.toFixed(2)} | Wins: ${hybrid.wins} | Losses: ${hybrid.losses} | Trades: ${hybrid.trades}`);

    console.log(`\n-----------------------------------------------`);
    if (standard.balance > hybrid.balance) {
        console.log(`💡 GANADOR: MODO ESTÁNDAR. Es más seguro operar a favor de la tendencia mayor.`);
    } else {
        console.log(`💡 GANADOR: MODO HÍBRIDO. Los rebotes (Alpha) están dando buena ganancia.`);
    }
}
