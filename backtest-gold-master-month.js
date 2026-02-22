const WebSocket = require('ws');

const APP_ID = 1089;
const SYMBOL = 'frxXAUUSD';

// --- CONFIGURACIÓN GOLD MASTER ---
const STAKE = 10;
const TP = 1.00;
const SL = 1.60;
const SMA20_P = 20;
const SMA40_P = 40;
const RSI_P = 14;

let botState = {
    balance: 1000,
    wins: 0,
    losses: 0,
    profit: 0,
    rsiValue: 50,
    setup: { active: false, side: null, resistance: null, support: null },
    activeTrade: null
};

let tradeHistory = [];
let startingBalance = 1000;

function calculateSMA(prices, period) {
    if (prices.length < period) return null;
    let sum = 0;
    for (let i = 0; i < period; i++) sum += prices[prices.length - 1 - i];
    return sum / period;
}

function calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) return 50;
    let gains = 0, losses = 0;
    for (let i = prices.length - period; i < prices.length; i++) {
        let diff = prices[i] - prices[i - 1];
        if (diff >= 0) gains += diff; else losses -= diff;
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    return 100 - (100 / (1 + (avgGain / avgLoss)));
}

async function startBacktest() {
    console.log("⏳ Conectando a Deriv API para descargar datos históricos mensuales...");

    // Para 1 mes, necesitamos simular con velas M5 o M15 si M1 no da suficiente historial, pero como queremos simular la estrategia M1 exacta, usaremos las máximas velas M1 que Deriv permite por endpoint (que son ~10.000, pero la limitación técnica real es menor, alrededor de 5.000 por request).
    // Para simplificar y abarcar 1 MES COMPLETO (30 días), la única forma técnica de hacerlo en un solo script es usando velas de 15 minutos (M15), ajustando las SMAs correspondientemente.

    console.log("⚠️ Simulación profunda de 30 días detectada. Cambiando la métrica base a M15 (15 Minutos) para cubrir 30 días completos (Deriv API Limits).");

    const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
    let candlesM15 = [];
    let candlesH4 = [];

    ws.on('open', () => {
        // Pedimos datos de ~1 Mes (30 días).
        // 1 mes = 30 * 24 horas = 720 horas = 720 velas H1. Para margen pedimos 1000.
        ws.send(JSON.stringify({ ticks_history: SYMBOL, end: 'latest', count: 1000, style: 'candles', granularity: 14400, req_id: 1 }));
    });

    ws.on('message', (data) => {
        const msg = JSON.parse(data);

        if (msg.req_id === 1 && msg.candles) {
            console.log("✅ Historico Macrotendencial (H4) de 30 días descargado.");
            candlesH4 = msg.candles;

            // 1 mes en velas de 15 minutos equivale a: 30 días * 24 horas * 4 velas/hora = 2880 velas.
            ws.send(JSON.stringify({ ticks_history: SYMBOL, end: 'latest', count: 3500, style: 'candles', granularity: 900, req_id: 2 }));
        }

        if (msg.req_id === 2 && msg.candles) {
            console.log("✅ Historico Operativo (M15) de 30 días descargado. Iniciando simulación...");
            candlesM15 = msg.candles;
            ws.terminate();
            runSimulation(candlesM15, candlesH4);
        }

        if (msg.error) {
            console.error("Error API:", msg.error.message);
            process.exit(1);
        }
    });
}

function runSimulation(candlesM15, candlesH4) {
    for (let i = 100; i < candlesM15.length; i++) {
        const currentCandle = candlesM15[i];
        const date = new Date(currentCandle.epoch * 1000);
        const hour = date.getUTCHours();
        const currentClose = currentCandle.close;
        const currentHigh = currentCandle.high;
        const currentLow = currentCandle.low;

        if (botState.activeTrade) {
            const entry = botState.activeTrade.entryPrice;
            const side = botState.activeTrade.side;

            const changeHigh = (currentHigh - entry) / entry * 120 * STAKE;
            const changeLow = (currentLow - entry) / entry * 120 * STAKE;

            let result = null;

            if (side === 'CALL') {
                if (changeHigh >= TP) result = TP;
                else if (changeLow <= -SL) result = -SL;
            } else {
                const changeP_High = (entry - currentLow) / entry * 120 * STAKE;
                const changeP_Low = (entry - currentHigh) / entry * 120 * STAKE;
                if (changeP_High >= TP) result = TP;
                else if (changeP_Low <= -SL) result = -SL;
            }

            if (result !== null) {
                botState.balance += result;
                if (result > 0) botState.wins++;
                else botState.losses++;
                botState.profit += result;
                tradeHistory.push({ date: date.toISOString(), side, pnl: result, balance: botState.balance });
                botState.activeTrade = null;
            }
            continue;
        }

        if (hour < 11 || hour > 21) continue;

        const sliceM15 = candlesM15.slice(i - 45, i + 1);
        const closesM15 = sliceM15.map(c => c.close);
        const s20 = calculateSMA(closesM15, SMA20_P);
        const s40 = calculateSMA(closesM15, SMA40_P);
        const rsi = calculateRSI(closesM15, RSI_P);

        // Alineación macro. Para M15 usamos filtro direccional de H4.
        const pastH4 = candlesH4.filter(c => c.epoch <= currentCandle.epoch);
        if (pastH4.length < 45) continue;
        const closesH4 = pastH4.map(c => c.close);
        const s20H4 = calculateSMA(closesH4, 20);
        const s40H4 = calculateSMA(closesH4, 40);

        const macroTrend = s20H4 > s40H4 ? 'UP' : (s20H4 < s40H4 ? 'DOWN' : 'NEUTRAL');

        // --- LÓGICA CALL ---
        if (macroTrend === 'UP' && s20 > s40) {
            if (currentLow <= s40 * 1.0002) {
                botState.setup = { active: true, side: 'CALL', resistance: currentHigh, support: null };
            }
            if (botState.setup.active && botState.setup.side === 'CALL' && currentClose > botState.setup.resistance && rsi < 70) {
                botState.activeTrade = { side: 'CALL', entryPrice: currentClose };
                botState.setup.active = false;
            } else if (botState.setup.active && botState.setup.side === 'CALL' && currentClose < s40) {
                botState.setup.active = false;
            }
        }
        // --- LÓGICA PUT ---
        else if (macroTrend === 'DOWN' && s20 < s40) {
            if (currentHigh >= s40 * 0.9998) {
                botState.setup = { active: true, side: 'PUT', support: currentLow, resistance: null };
            }
            if (botState.setup.active && botState.setup.side === 'PUT' && currentClose < botState.setup.support && rsi > 30) {
                botState.activeTrade = { side: 'PUT', entryPrice: currentClose };
                botState.setup.active = false;
            } else if (botState.setup.active && botState.setup.side === 'PUT' && currentClose > s40) {
                botState.setup.active = false;
            }
        }
    }

    console.log("=====================================================");
    console.log("📊 RESULTADOS BACKTESTING - GOLD MASTER PRO (ÚLTIMO MES)");
    console.log("=====================================================");
    console.log(`Instrumento          : ${SYMBOL}`);
    console.log(`Período Estudiado    : Últimos 30 Días`);
    console.log(`Motor de Simulación  : Base temporal re-escalada (M15 / H4)`);
    console.log(`Bloqueo Horario      : 11:00 UTC - 21:00 UTC (Londres/NY)`);
    console.log(`Stake por Op.        : $${STAKE}`);
    console.log(`Take Profit Fijo     : $${TP}`);
    console.log(`Stop Loss Fijo       : $${SL}`);
    console.log("-----------------------------------------------------");
    const totalOps = botState.wins + botState.losses;
    console.log(`Total Operaciones    : ${totalOps}`);
    console.log(`Operaciones Ganadas  : ${botState.wins} ✅`);
    console.log(`Operaciones Perdidas : ${botState.losses} ❌`);
    console.log(`Win Rate (Precisión) : ${totalOps > 0 ? ((botState.wins / totalOps) * 100).toFixed(2) : 0}%`);
    console.log(`Beneficio Neto (PnL) : $${botState.profit.toFixed(2)}`);
    console.log("-----------------------------------------------------");
    console.log(`Balance Inicial      : $${startingBalance}`);
    console.log(`Balance Final        : $${botState.balance.toFixed(2)}`);
    console.log("=====================================================");
    process.exit(0);
}

startBacktest();
