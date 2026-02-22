const WebSocket = require('ws');

const APP_ID = 1089;
const SYMBOL = 'frxXAUUSD';
const MULTIPLIER = 40;
const STAKE = 10;

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

let allM1Candles = [];
console.log(`\n🕵️‍♂️ AUDITORÍA DE ALTA PRECISIÓN: OPTIMIZANDO TP/SL PARA ORO`);
console.log(`==========================================================`);

ws.on('open', () => {
    loadChunk(Math.floor(Date.now() / 1000), 4);
});

function loadChunk(beforeTS, remaining) {
    ws.send(JSON.stringify({
        ticks_history: SYMBOL, end: beforeTS, count: 5000, granularity: 60, style: 'candles'
    }));
    ws.once('message', (data) => {
        const msg = JSON.parse(data);
        const candles = msg.candles || [];
        allM1Candles = candles.concat(allM1Candles);
        if (remaining > 1 && candles.length > 0) loadChunk(candles[0].epoch - 1, remaining - 1);
        else { runHyperOptimization(); ws.close(); }
    });
}

function runHyperOptimization() {
    allM1Candles.sort((a, b) => a.epoch - b.epoch);
    const closes = allM1Candles.map(c => c.close);

    // Probamos la PM-40 (la más robusta estructuralmente) 
    // pero variando agresivamente el TP/SL y el tiempo de expiración.

    const TP_RANGE = [0.10, 0.20, 0.40, 0.80, 1.20]; // En dólares de balance
    const SL_RANGE = [0.20, 0.40, 0.80, 1.50, 2.50];
    const EXPIRE_RANGE = [5, 15, 30, 60]; // Minutos

    let best = { pnl: -999 };

    const smaF = calculateSMA(closes, 20);
    const smaS = calculateSMA(closes, 40);

    for (let tp of TP_RANGE) {
        for (let sl of SL_RANGE) {
            for (let exp of EXPIRE_RANGE) {
                let res = backtest(smaF, smaS, tp, sl, exp);
                if (res.pnl > best.pnl) {
                    best = { ...res, tp, sl, exp };
                }
            }
        }
    }

    report(best);
}

function calculateSMA(prices, period) {
    let smas = new Array(prices.length).fill(null);
    for (let i = period - 1; i < prices.length; i++) {
        let sum = 0;
        for (let j = 0; j < period; j++) sum += prices[i - j];
        smas[i] = sum / period;
    }
    return smas;
}

function backtest(smaF, smaS, tp, sl, exp) {
    let pnl = 0, wins = 0, losses = 0;
    for (let i = 100; i < allM1Candles.length - exp; i++) {
        const c = allM1Candles[i];
        const hour = new Date(c.epoch * 1000).getUTCHours();
        if (hour < 8 || hour > 19) continue; // Filtro Sesión

        let type = null;
        if (smaF[i] > smaS[i] && allM1Candles[i].low <= smaS[i] * 1.0001) type = 'CALL';
        else if (smaF[i] < smaS[i] && allM1Candles[i].high >= smaS[i] * 0.9999) type = 'PUT';

        if (type) {
            let res = simulate(i, type, tp, sl, exp);
            pnl += res; (res > 0) ? wins++ : losses++;
            i += 10;
        }
    }
    return { pnl, wins, losses };
}

function simulate(startIdx, type, tp, sl, exp) {
    let entry = allM1Candles[startIdx + 1]?.open || allM1Candles[startIdx].close;
    for (let j = startIdx + 1; j < startIdx + exp && j < allM1Candles.length; j++) {
        let p, l;
        if (type === 'CALL') {
            p = ((allM1Candles[j].high - entry) / entry) * MULTIPLIER * STAKE;
            l = ((allM1Candles[j].low - entry) / entry) * MULTIPLIER * STAKE;
        } else {
            p = ((entry - allM1Candles[j].low) / entry) * MULTIPLIER * STAKE;
            l = ((entry - allM1Candles[j].high) / entry) * MULTIPLIER * STAKE;
        }
        if (p >= tp) return tp;
        if (l <= -sl) return -sl;
    }
    return 0; // Si no toca ninguno, cerramos en break-even (simulado)
}

function report(b) {
    console.log(`\n==========================================================`);
    console.log(`💎 CONFIGURACIÓN MAESTRA DESCUBIERTA`);
    console.log(`==========================================================`);
    console.log(`Estrategia: PM-40 Bidireccional (CALL/PUT)`);
    console.log(`Filtro Horario: 08:00 - 19:00 UTC (Bolsas abiertas)`);
    console.log(`Target Profit (TP): $${b.tp.toFixed(2)}`);
    console.log(`Stop Loss (SL): $${b.sl.toFixed(2)}`);
    console.log(`Expiración Max: ${b.exp} minutos`);
    console.log(`--------------------------------------------------`);
    console.log(`Rendimiento Esperado: +$${b.pnl.toFixed(2)} / mes`);
    console.log(`Win Rate: ${((b.wins / (b.wins + b.losses)) * 100 || 0).toFixed(1)}%`);
    console.log(`Profit Factor: ${(Math.abs(b.wins * b.tp) / Math.abs(b.losses * b.sl)).toFixed(2)}`);
    console.log(`==========================================================\n`);
    console.log(`💡 EL SECRETO: En el Oro, la precisión es más importante`);
    console.log(`que el monto. TP pequeños permiten salir rápido del ruido.`);
}
