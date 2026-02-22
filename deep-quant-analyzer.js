const WebSocket = require('ws');

const APP_ID = 1089;
const SYMBOL = 'frxXAUUSD';
const MULTIPLIER = 40;
const STAKE = 10;
const DAYS_TO_BACKTEST = 30; // Un mes completo

const endTS = Math.floor(Date.now() / 1000);
const startTS = endTS - (DAYS_TO_BACKTEST * 24 * 60 * 60);

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

let allM1Candles = [];
let allH1Candles = [];

console.log(`\n🕵️‍♂️ INICIANDO AUDITORÍA CUÁNTICA: ORO (30 DÍAS)`);
console.log(`==========================================================`);
console.log(`Objetivo: Encontrar el "Santo Grial" del XAUUSD`);
console.log(`Analizando desde: ${new Date(startTS * 1000).toLocaleDateString()}`);
console.log(`Cargando Big Data...`);

ws.on('open', () => {
    fetchH1();
});

function fetchH1() {
    ws.send(JSON.stringify({
        ticks_history: SYMBOL, end: 'latest', start: startTS, granularity: 3600, style: 'candles'
    }));
}

function requestM1(beforeTS) {
    ws.send(JSON.stringify({
        ticks_history: SYMBOL, end: beforeTS, count: 5000, granularity: 60, style: 'candles'
    }));
}

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.msg_type === 'candles') {
        if (msg.echo_req.granularity === 3600) {
            allH1Candles = msg.candles || [];
            console.log(`📊 Datos H1 listos (${allH1Candles.length} velas). Cargando M1...`);
            requestM1(endTS);
        } else {
            const received = msg.candles || [];
            allM1Candles = received.concat(allM1Candles);

            const earliest = received[0]?.epoch;
            if (earliest && earliest > startTS && received.length === 5000) {
                process.stdout.write(".");
                requestM1(earliest - 1);
            } else {
                console.log(`\n✅ Big Data Cargado: ${allM1Candles.length} velas M1 logradas.`);
                runDeepOptimization();
                ws.close();
            }
        }
    }
});

function calculateSMA(prices, period) {
    let smas = new Array(prices.length).fill(null);
    for (let i = period - 1; i < prices.length; i++) {
        let sum = 0;
        for (let j = 0; j < period; j++) sum += prices[i - j];
        smas[i] = sum / period;
    }
    return smas;
}

function runDeepOptimization() {
    allM1Candles.sort((a, b) => a.epoch - b.epoch);
    allH1Candles.sort((a, b) => a.epoch - b.epoch);

    const m1Closes = allM1Candles.map(c => c.close);
    const h1Closes = allH1Candles.map(c => c.close);

    // Parámetros a optimizar (Brute Force)
    const SMA_FAST_RANGE = [10, 20, 30];
    const SMA_SLOW_RANGE = [40, 50, 60];
    const TP_RANGE = [0.5, 1.0, 1.5, 2.0];
    const SL_RANGE = [1.0, 2.0, 3.0, 5.0];

    let bestStrategy = { pnl: -99999 };
    let totalCombinations = SMA_FAST_RANGE.length * SMA_SLOW_RANGE.length * TP_RANGE.length * SL_RANGE.length;
    let currentComb = 0;

    console.log(`🚀 Ejecutando optimización en ${totalCombinations} universos paralelos...`);

    for (const fast of SMA_FAST_RANGE) {
        for (const slow of SMA_SLOW_RANGE) {
            const m1SF = calculateSMA(m1Closes, fast);
            const m1SS = calculateSMA(m1Closes, slow);
            const h1SF = calculateSMA(h1Closes, fast);
            const h1SS = calculateSMA(h1Closes, slow);

            for (const tp of TP_RANGE) {
                for (const sl of SL_RANGE) {
                    currentComb++;
                    const result = simulate(m1SF, m1SS, h1SF, h1SS, tp, sl);
                    if (result.pnl > bestStrategy.pnl) {
                        bestStrategy = { ...result, fast, slow, tp, sl };
                    }
                }
            }
        }
    }

    reportBest(bestStrategy);
}

function simulate(m1SF, m1SS, h1SF, h1SS, targetTP, targetSL) {
    let pnl = 0, wins = 0, losses = 0;

    for (let i = 60; i < allM1Candles.length - 20; i++) {
        const c = allM1Candles[i];
        const h1C = allH1Candles.findLast(h => h.epoch <= c.epoch);
        if (!h1C) continue;
        const h1Idx = allH1Candles.indexOf(h1C);
        if (h1Idx < 60) continue;

        // --- LÓGICA BIDIRECCIONAL ---

        // 1. CALL (Tendencia Alcista)
        if (h1SF[h1Idx] > h1SS[h1Idx] && m1SF[i] > m1SS[i]) {
            if (allM1Candles[i].low <= m1SS[i] * 1.0002) { // Pullback a la lenta
                let res = fastSim(i, 'CALL', targetTP, targetSL);
                pnl += res; (res > 0) ? wins++ : losses++;
                i += 15; // Cooldown
            }
        }
        // 2. PUT (Tendencia Bajista)
        else if (h1SF[h1Idx] < h1SS[h1Idx] && m1SF[i] < m1SS[i]) {
            if (allM1Candles[i].high >= m1SS[i] * 0.9998) { // Pullback a la lenta
                let res = fastSim(i, 'PUT', targetTP, targetSL);
                pnl += res; (res > 0) ? wins++ : losses++;
                i += 15; // Cooldown
            }
        }
    }

    return { pnl, wins, losses };
}

function fastSim(startIdx, type, tp, sl) {
    let entry = allM1Candles[startIdx + 1]?.open || allM1Candles[startIdx].close;
    // Buscamos en las siguientes 30 velas (30 mins max)
    for (let j = startIdx + 1; j < startIdx + 30 && j < allM1Candles.length; j++) {
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
    return -sl * 0.5; // Salida por tiempo (pérdida reducida)
}

function reportBest(b) {
    console.log(`\n==========================================================`);
    console.log(`🏆 ESTRATEGIA DEFINITIVA IDENTIFICADA`);
    console.log(`==========================================================`);
    console.log(`Configuración SMA: Fast ${b.fast} | Slow ${b.slow}`);
    console.log(`Gestión: TP $${b.tp} | SL -$${b.sl}`);
    console.log(`PnL Total Mes: +$${b.pnl.toFixed(2)}`);
    console.log(`Win Rate: ${((b.wins / (b.wins + b.losses)) * 100).toFixed(1)}%`);
    console.log(`Profit Factor: ${(Math.abs(b.wins * b.tp) / Math.abs(b.losses * b.sl)).toFixed(2)}`);
    console.log(`==========================================================\n`);
    console.log(`💡 Nota del Analista: Esta configuración aprovecha los retrocesos`);
    console.log(`institucionales tanto en subidas como en caídas.`);
}
