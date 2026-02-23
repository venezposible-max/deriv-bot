const WebSocket = require('ws');

const APP_ID = 1089;
const SYMBOL = 'frxXAUUSD';

const STAKE = 10;
const TP = 1.00;
const SL = 1.60;
const SMA20_P = 20;
const SMA40_P = 40;
const RSI_P = 14;

let globalWs;
let candlesM1 = [];
let candlesH1 = [];
let botState = {
    balance: 1000,
    wins: 0,
    losses: 0,
    profit: 0,
    setup: { active: false, side: null, resistance: null, support: null },
    activeTrade: null
};

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
    let avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    return 100 - (100 / (1 + ((gains / period) / avgLoss)));
}

async function startBacktest() {
    console.log("⏳ Descargando datos masivos de la semana pasada completa (Deriv API)...");

    globalWs = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

    // Rango de la semana pasada (Lunes 16 de Febrero - Viernes 20 de Febrero)
    // Pedimos H1 desde el 12 de Febrero para tener SMA lista para el lunes.
    const unixStartH1 = Math.floor(new Date("2026-02-12T00:00:00Z").getTime() / 1000);
    const unixEndH1 = Math.floor(new Date("2026-02-20T23:59:59Z").getTime() / 1000);

    const unixStartM1 = Math.floor(new Date("2026-02-15T20:00:00Z").getTime() / 1000);
    const unixEndM1 = Math.floor(new Date("2026-02-20T23:59:59Z").getTime() / 1000);

    globalWs.on('open', () => {
        globalWs.send(JSON.stringify({ ticks_history: SYMBOL, start: unixStartH1, end: unixEndH1, count: 1000, style: 'candles', granularity: 3600, req_id: 1 }));
    });

    globalWs.on('message', (data) => {
        const msg = JSON.parse(data);
        if (msg.req_id === 1 && msg.candles) {
            candlesH1 = msg.candles;
            // Deriv limits max 5000 count. The week has 5 days * 24h * 60m = 7200 minutes. 
            // So we might need to split M1 request or limit the test if Deriv truncates.
            // Let's ask for the maximum possible count in the timeframe.
            globalWs.send(JSON.stringify({ ticks_history: SYMBOL, start: unixStartM1, end: unixEndM1, count: 10000, style: 'candles', granularity: 60, req_id: 2 }));
        }

        if (msg.req_id === 2 && msg.candles) {
            candlesM1 = msg.candles;
            globalWs.terminate();
            runSimulation();
        }

        if (msg.error) {
            console.error("Error API:", msg.error.message);
            process.exit(1);
        }
    });
}

function runSimulation() {
    const days = [
        { name: "Lunes", date: "2026-02-16", wins: 0, losses: 0, pnl: 0, trades: 0 },
        { name: "Martes", date: "2026-02-17", wins: 0, losses: 0, pnl: 0, trades: 0 },
        { name: "Miércoles", date: "2026-02-18", wins: 0, losses: 0, pnl: 0, trades: 0 },
        { name: "Jueves", date: "2026-02-19", wins: 0, losses: 0, pnl: 0, trades: 0 },
        { name: "Viernes", date: "2026-02-20", wins: 0, losses: 0, pnl: 0, trades: 0 }
    ];

    let currentDayStr = "";
    let activeDayObj = null;

    for (let i = 45; i < candlesM1.length; i++) {
        const currentCandle = candlesM1[i];
        const epochMs = currentCandle.epoch * 1000;
        const dateObj = new Date(epochMs);
        const hour = dateObj.getUTCHours();

        // Formato ISO Fecha para comparar: YYYY-MM-DD
        const loopDayStr = dateObj.toISOString().split('T')[0];

        // Cambiar de día si aplica
        if (loopDayStr !== currentDayStr) {
            currentDayStr = loopDayStr;
            activeDayObj = days.find(d => d.date === currentDayStr);
        }

        // Si es fin de semana o fuera de días de interés, omitir
        if (!activeDayObj) continue;

        const currentClose = currentCandle.close;
        const currentHigh = currentCandle.high;
        const currentLow = currentCandle.low;

        // Gestión del Trade Activo
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
                if (result > 0) {
                    botState.wins++;
                    activeDayObj.wins++;
                } else {
                    botState.losses++;
                    activeDayObj.losses++;
                }
                botState.profit += result;
                activeDayObj.pnl += result;
                activeDayObj.trades++;
                botState.activeTrade = null;
            }
            continue;
        }

        // Fuera de sesión
        if (hour < 11 || hour > 21) continue;

        const sliceM1 = candlesM1.slice(i - 45, i + 1);
        const closesM1 = sliceM1.map(c => c.close);
        const s20 = calculateSMA(closesM1, SMA20_P);
        const s40 = calculateSMA(closesM1, SMA40_P);
        const rsi = calculateRSI(closesM1, RSI_P);

        const pastH1 = candlesH1.filter(c => c.epoch <= currentCandle.epoch);
        if (pastH1.length < 40) continue;
        const closesH1 = pastH1.map(c => c.close);
        const s20H1 = calculateSMA(closesH1, 20);
        const s40H1 = calculateSMA(closesH1, 40);

        const h1Trend = s20H1 > s40H1 ? 'UP' : (s20H1 < s40H1 ? 'DOWN' : 'NEUTRAL');

        if (h1Trend === 'UP' && s20 > s40) {
            if (currentLow <= s40 * 1.0002) botState.setup = { active: true, side: 'CALL', resistance: currentHigh };
            if (botState.setup.active && botState.setup.side === 'CALL' && currentClose > botState.setup.resistance && rsi < 70) {
                botState.activeTrade = { side: 'CALL', entryPrice: currentClose };
                botState.setup.active = false;
            } else if (botState.setup.active && botState.setup.side === 'CALL' && currentClose < s40) {
                botState.setup.active = false;
            }
        }
        else if (h1Trend === 'DOWN' && s20 < s40) {
            if (currentHigh >= s40 * 0.9998) botState.setup = { active: true, side: 'PUT', support: currentLow };
            if (botState.setup.active && botState.setup.side === 'PUT' && currentClose < botState.setup.support && rsi > 30) {
                botState.activeTrade = { side: 'PUT', entryPrice: currentClose };
                botState.setup.active = false;
            } else if (botState.setup.active && botState.setup.side === 'PUT' && currentClose > s40) {
                botState.setup.active = false;
            }
        }
    }

    console.log("=========================================================");
    console.log("📊 RESULTADOS BACKTESTING DIARIO - GOLD MASTER PRO");
    console.log("📅 SEMANA: Del 16 al 20 de Febrero de 2026");
    console.log("=========================================================");
    console.log("DÍA       | TRADES | GANADAS | PERDIDAS |  WIN RATE |  PnL");
    console.log("---------------------------------------------------------");

    days.forEach(d => {
        const wr = d.trades > 0 ? ((d.wins / d.trades) * 100).toFixed(1) : "0.0";
        const pnl = d.pnl >= 0 ? `+$${d.pnl.toFixed(2)}` : `-$${Math.abs(d.pnl).toFixed(2)}`;
        console.log(`${d.name.padEnd(9)} |   ${d.trades.toString().padEnd(3)}  |    ${d.wins.toString().padEnd(3)}  |    ${d.losses.toString().padEnd(4)}  |   ${wr.padStart(5)}%  | ${pnl}`);
    });

    console.log("=========================================================");
    console.log("💰 RESUMEN TOTAL SEMANAL:");
    console.log(`Total Trades Realizados: ${botState.wins + botState.losses}`);
    console.log(`Efectividad Global:      ${((botState.wins / (botState.wins + botState.losses)) * 100).toFixed(2)}%`);
    console.log(`Beneficio Limpio (PnL):  $${botState.profit.toFixed(2)} en Verde`);
    console.log("=========================================================");
}
startBacktest();
