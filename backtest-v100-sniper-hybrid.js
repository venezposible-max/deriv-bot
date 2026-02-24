const WebSocket = require('ws');

const APP_ID = 1089;
const SYMBOL = 'R_100'; // Volatility 100
const API_TOKEN = process.env.DERIV_TOKEN || '';

// --- CONFIGURACIÓN SNIPER PRO (V100 - HÍBRIDO + ALPHA + TRAILING) ---
const SNIPER_CONFIG = {
    stake: 20,
    takeProfit: 10.00,
    stopLoss: 3.00,
    multiplier: 40, // Multiplicador corregido a 40 para V100
    smaPeriod: 50,
    rsiPeriod: 14,
    momentum: 7,
    useHybrid: true
};

let ws;
let candleHistory = [];
let tickHistory = [];
let botState = {
    balance: 1000,
    wins: 0,
    losses: 0,
    profit: 0,
    currentContract: null,
    currentMaxProfit: 0,
    lastSlAssigned: -12,
    cooldownRemaining: 0
};

let tradeHistory = [];
const STARTING_BALANCE = 1000;

function calculateSMA(data, period) {
    if (data.length < period) return null;
    let sum = 0;
    for (let i = 0; i < period; i++) sum += data[data.length - 1 - i];
    return sum / period;
}

function calculateRSI(data, period = 14) {
    if (data.length < period + 1) return 50;
    let gains = 0, losses = 0;
    for (let i = data.length - period; i < data.length; i++) {
        let diff = data[i] - data[i - 1];
        if (diff >= 0) gains += diff; else losses -= diff;
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    return 100 - (100 / (1 + (avgGain / avgLoss)));
}

async function startBacktest() {
    console.log("⏳ Descargando datos de 48 Horas (V100) para Sniper Pro...");
    ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

    ws.on('open', () => {
        // Pedimos 3000 velas M1 (aprox 2 días para V100, que es 24/7)
        ws.send(JSON.stringify({
            ticks_history: SYMBOL,
            end: 'latest',
            count: 3000,
            style: 'candles',
            granularity: 60,
            req_id: 1
        }));
    });

    ws.on('message', (data) => {
        const msg = JSON.parse(data);
        if (msg.req_id === 1 && msg.candles) {
            console.log(`✅ ${msg.candles.length} velas M1 descargadas. Iniciando simulación...`);
            candleHistory = msg.candles;
            runSimulation();
        }
        if (msg.error) {
            console.error("❌ Error API:", msg.error.message);
            process.exit(1);
        }
    });
}

function runSimulation() {
    for (let i = 100; i < candleHistory.length; i++) {
        const candle = candleHistory[i];
        const quote = candle.close;
        const high = candle.high;
        const low = candle.low;

        // Gestión de Cooldown
        if (botState.cooldownRemaining > 0) botState.cooldownRemaining--;

        // Gestión del Trade Activo
        if (botState.currentContract) {
            const entry = botState.currentContract.entryPrice;
            const side = botState.currentContract.side;

            // Simulación simplificada basada en el movimiento de la vela
            const pricesToCheck = side === 'CALL' ? [low, high, quote] : [high, low, quote];

            for (let p of pricesToCheck) {
                let pChangePct = (p - entry) / entry;
                if (side === 'PUT' || side === 'MULTDOWN') pChangePct = -pChangePct;

                let liveProfit = pChangePct * SNIPER_CONFIG.multiplier * SNIPER_CONFIG.stake;

                if (liveProfit > botState.currentMaxProfit) botState.currentMaxProfit = liveProfit;

                // --- LÓGICA TRAILING ---
                if (botState.currentMaxProfit >= 9.00 && botState.lastSlAssigned < 8.00) botState.lastSlAssigned = 8.00;
                else if (botState.currentMaxProfit >= 6.00 && botState.lastSlAssigned < 4.50) botState.lastSlAssigned = 4.50;
                else if (botState.currentMaxProfit >= 4.00 && botState.lastSlAssigned < 2.50) botState.lastSlAssigned = 2.50;
                else if (botState.currentMaxProfit >= 2.50 && botState.lastSlAssigned < 1.00) botState.lastSlAssigned = 1.00;
                else if (botState.currentMaxProfit >= 1.00 && botState.lastSlAssigned < 0.20) botState.lastSlAssigned = 0.20;

                let exitResult = null;

                if (botState.lastSlAssigned > 0 && liveProfit <= botState.lastSlAssigned) exitResult = liveProfit;
                else if (liveProfit >= SNIPER_CONFIG.takeProfit) exitResult = liveProfit;
                else if (liveProfit <= -SNIPER_CONFIG.stopLoss) exitResult = liveProfit;

                if (exitResult !== null) {
                    botState.balance += exitResult;
                    if (exitResult > 0) botState.wins++; else botState.losses++;
                    botState.profit += exitResult;
                    botState.currentContract = null;
                    botState.cooldownRemaining = 15; // Cooldown más corto para V100
                    break;
                }
            }
            continue;
        }

        // --- LÓGICA DE ENTRADA (V100 es 24/7) ---
        const sliceM1 = candleHistory.slice(i - 100, i + 1);
        const closesM1 = sliceM1.map(c => c.close);
        tickHistory = closesM1;

        if (tickHistory.length >= SNIPER_CONFIG.smaPeriod) {
            const sma = calculateSMA(tickHistory, SNIPER_CONFIG.smaPeriod);
            const rsi = calculateRSI(tickHistory, SNIPER_CONFIG.rsiPeriod);

            const lastMomentum = tickHistory.slice(-SNIPER_CONFIG.momentum);
            const allDown = lastMomentum.every((v, idx) => idx === 0 || v < lastMomentum[idx - 1]);
            const allUp = lastMomentum.every((v, idx) => idx === 0 || v > lastMomentum[idx - 1]);

            let direction = null;

            if (sma && rsi) {
                const distPct = Math.abs(quote - sma) / sma * 100;

                // 1. Sniper (Tendencia)
                if (distPct < 0.10 && rsi >= 45 && rsi <= 55) {
                    const ranges = candleHistory.slice(i - 14, i).map(c => c.high - c.low);
                    const atr = ranges.reduce((a, b) => a + b, 0) / ranges.length;
                    const currentRange = candle.high - candle.low;

                    if (currentRange >= atr * 2.0) {
                        if (allUp) direction = 'CALL';
                        if (allDown) direction = 'PUT';
                    }
                }
                // 2. Alpha (Reversión)
                else if (distPct > 0.35) {
                    if (allUp && rsi > 80) direction = 'PUT';
                    if (allDown && rsi < 20) direction = 'CALL';
                }
            }

            if (direction && botState.cooldownRemaining === 0) {
                botState.currentContract = { side: direction, entryPrice: quote };
                botState.currentMaxProfit = 0;
                botState.lastSlAssigned = -12;
            }
        }
    }

    printResults();
}

function printResults() {
    console.log("=====================================================");
    console.log("📊 RESULTADOS BACKTESTING: SNIPER PRO (V100)");
    console.log("=====================================================");
    console.log(`Instrumento      : ${SYMBOL} (V100)`);
    console.log(`Configuración    : Híbrido + Alpha + Trailing`);
    console.log(`Stake/Mult       : $${SNIPER_CONFIG.stake} / x${SNIPER_CONFIG.multiplier}`);
    console.log(`TP / SL          : $${SNIPER_CONFIG.takeProfit} / $${SNIPER_CONFIG.stopLoss}`);
    console.log("-----------------------------------------------------");
    const totalOps = botState.wins + botState.losses;
    console.log(`Total Operaciones : ${totalOps}`);
    console.log(`Ganadas ✅        : ${botState.wins}`);
    console.log(`Perdidas ❌       : ${botState.losses}`);
    console.log(`Win Rate          : ${totalOps > 0 ? ((botState.wins / totalOps) * 100).toFixed(2) : 0}%`);
    console.log(`PnL Neto          : $${botState.profit.toFixed(2)}`);
    console.log("-----------------------------------------------------");
    console.log(`Balance Final     : $${botState.balance.toFixed(2)}`);
    console.log("=====================================================");
    process.exit(0);
}

startBacktest();
