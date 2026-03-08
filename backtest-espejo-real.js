const WebSocket = require('ws');
const APP_ID = 1089;
const SYMBOL = 'R_100';

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
let allTicks = [];
const TICKS_TO_FETCH = 6500; // ~1h 30m

// PARÁMETROS EXACTOS DE TU SERVER-BOT.JS
const SNIPER_CONFIG = {
    stake: 20,
    takeProfit: 3.00,
    stopLoss: 1.50,
    multiplier: 40,
    smaPeriod: 50,
    smaLongPeriod: 200,
    rsiPeriod: 14,
    rsiLow: 45,
    rsiHigh: 55,
    momentum: 5,
    distLimit: 0.08,
    trailStart: 0.50,
    trailDist: 0.50
};

ws.on('open', () => {
    console.log(`📥 Descargando DATA TICKS para ESPEJO EXACTO (Últimos 90 min)...`);
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
        if (allTicks.length < TICKS_TO_FETCH && chunk.length > 0) {
            process.stdout.write('.');
            fetchTicks(times[0]);
        } else {
            console.log(`\n✅ DATA CARGADA. Iniciando Simulación Espejo...`);
            runSimulation();
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

function runSimulation() {
    let balance = 0, wins = 0, losses = 0, trades = 0;
    let inTrade = false, entryPrice = 0, tradeType = null, maxProfit = 0, lastSl = -100;

    const simulationTicks = allTicks.slice(-5400); // 90 min aprox

    console.log(`\n📊 SIMULACIÓN ESPEJO: Lógica Exacta de server-bot.js`);
    console.log(`Filtros: SMA200 + Distancia < 0.08% + RSI(>45 UP / <55 DOWN)`);
    console.log(`----------------------------------------------------`);
    console.log(`Nº | TIPO | RESULTADO | PnL | BALANCE ACUM.`);

    for (let i = 250; i < simulationTicks.length; i++) {
        const quote = simulationTicks[i];

        if (!inTrade) {
            const lastTicks = simulationTicks.slice(i - SNIPER_CONFIG.momentum, i);
            const allDown = lastTicks.every((v, j) => j === 0 || v < lastTicks[j - 1]);
            const allUp = lastTicks.every((v, j) => j === 0 || v > lastTicks[j - 1]);

            // LÓGICA DE TU SERVIDOR (Líneas 577-596)
            const sma50 = calculateSMA(simulationTicks.slice(0, i), SNIPER_CONFIG.smaPeriod);
            const trendMayor = calculateSMA(simulationTicks.slice(0, i), SNIPER_CONFIG.smaLongPeriod);
            const rsi = calculateRSI(simulationTicks.slice(0, i), SNIPER_CONFIG.rsiPeriod);

            if (sma50 && trendMayor && rsi) {
                const distPct = Math.abs(quote - sma50) / sma50 * 100;

                // EL FILTRO MAESTRO QUE LIMITA LOS TRADES (distPct < 0.08)
                if (distPct < 0.08) {
                    let direction = null;

                    if (allUp && quote > trendMayor && rsi > SNIPER_CONFIG.rsiLow) {
                        direction = 'UP';
                    }
                    if (allDown && quote < trendMayor && rsi < SNIPER_CONFIG.rsiHigh) {
                        direction = 'DOWN';
                    }

                    if (direction) {
                        inTrade = true; tradeType = direction; entryPrice = quote; maxProfit = 0; lastSl = -100; trades++;
                    }
                }
            }
        } else {
            let diff = (quote - entryPrice) / entryPrice;
            if (tradeType === 'DOWN') diff = -diff;
            let prof = diff * SNIPER_CONFIG.multiplier * SNIPER_CONFIG.stake;
            if (prof > maxProfit) maxProfit = prof;

            if (maxProfit >= 0.50) {
                const currentStep = Math.floor(maxProfit / 0.50) * 0.50;
                const newFloor = currentStep - 0.50;
                if (newFloor > lastSl) lastSl = newFloor;
            }

            let closed = false;
            let pnl = 0;
            let resTxt = "";

            if (prof <= -SNIPER_CONFIG.stopLoss) {
                pnl = -SNIPER_CONFIG.stopLoss; resTxt = "❌ LOSS"; closed = true;
            } else if (prof >= SNIPER_CONFIG.takeProfit) {
                pnl = SNIPER_CONFIG.takeProfit; resTxt = "✅ TARGET"; closed = true;
            } else if (lastSl > -99 && prof <= lastSl) {
                pnl = lastSl; resTxt = "🛡️ TRAIL"; closed = true;
            }

            if (closed) {
                balance += pnl;
                if (pnl > 0) wins++; else losses++;
                inTrade = false;
                console.log(`${trades.toString().padStart(3)} | ${tradeType.padEnd(4)} | ${resTxt.padEnd(8)} | $${pnl.toFixed(2).padStart(6)} | $${balance.toFixed(2).padStart(8)}`);
            }
        }
    }

    console.log(`----------------------------------------------------`);
    console.log(`TOTAL TRADES EN EL SIMULADOR: ${trades}`);
    console.log(`RESULTADO NETO: $${balance.toFixed(2)}`);
    console.log(`====================================================`);
}
