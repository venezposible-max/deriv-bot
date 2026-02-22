const WebSocket = require('ws');

const APP_ID = 1089;
const SYMBOL = 'frxXAUUSD';
const MULTIPLIER = 40;
const STAKE = 10;

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

let allM1Candles = [];
console.log(`\n🕵️‍♂️ INICIANDO AUDITORÍA SUPER-CUÁNTICA: ORO (XAUUSD)`);
console.log(`==========================================================`);

ws.on('open', () => {
    // Intentamos cargar 4 bloques de 5000 velas (~13 días de datos M1)
    loadChunk(Math.floor(Date.now() / 1000), 4);
});

function loadChunk(beforeTS, remaining) {
    ws.send(JSON.stringify({
        ticks_history: SYMBOL,
        end: beforeTS,
        count: 5000,
        granularity: 60,
        style: 'candles'
    }));

    ws.once('message', (data) => {
        const msg = JSON.parse(data);
        const candles = msg.candles || [];
        allM1Candles = candles.concat(allM1Candles);
        console.log(`📥 Cargado bloque: ${candles.length} velas. Total: ${allM1Candles.length}`);

        if (remaining > 1 && candles.length > 0) {
            loadChunk(candles[0].epoch - 1, remaining - 1);
        } else {
            console.log(`✅ Carga terminada. Procesando ${allM1Candles.length} velas.`);
            runExpertAnalysis();
            ws.close();
        }
    });
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

function calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) return new Array(prices.length).fill(null);
    let rsi = new Array(prices.length).fill(null);
    let gains = 0, losses = 0;

    for (let i = 1; i <= period; i++) {
        let diff = prices[i] - prices[i - 1];
        if (diff >= 0) gains += diff; else losses -= diff;
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;

    for (let i = period + 1; i < prices.length; i++) {
        let diff = prices[i] - prices[i - 1];
        let gain = diff >= 0 ? diff : 0;
        let loss = diff < 0 ? -diff : 0;
        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;
        let rs = avgGain / avgLoss;
        rsi[i] = 100 - (100 / (1 + rs));
    }
    return rsi;
}

function runExpertAnalysis() {
    allM1Candles.sort((a, b) => a.epoch - b.epoch);
    const closes = allM1Candles.map(c => c.close);
    const high = allM1Candles.map(c => c.high);
    const low = allM1Candles.map(c => c.low);

    const ARCHETYPES = [
        { name: "PM-40 (Trend Pullback)", fast: 20, slow: 40, rsiFilter: false },
        { name: "Momentum Sniper (9/21)", fast: 9, slow: 21, rsiFilter: true },
        { name: "Institutional (50/100)", fast: 40, slow: 60, rsiFilter: false },
        { name: "Scalper Pro (5/15 + RSI)", fast: 5, slow: 15, rsiFilter: true }
    ];

    console.log(`\n🚀 ANALIZANDO ${ARCHETYPES.length} ARQUETIPOS DE ESTRATEGIA...`);

    ARCHETYPES.forEach(arch => {
        const smaF = calculateSMA(closes, arch.fast);
        const smaS = calculateSMA(closes, arch.slow);
        const rsi = calculateRSI(closes, 14);

        let res = backtest(arch, smaF, smaS, rsi);
        console.log(`--------------------------------------------------`);
        console.log(`📋 ESTRATEGIA: ${arch.name}`);
        console.log(`PnL Total: $${res.pnl.toFixed(2)} | W: ${res.wins} L: ${res.losses}`);
        console.log(`Win Rate: ${((res.wins / (res.wins + res.losses)) * 100 || 0).toFixed(1)}%`);
        console.log(`Profit Factor: ${res.pf.toFixed(2)}`);
    });
}

function backtest(arch, smaF, smaS, rsi) {
    let pnl = 0, wins = 0, losses = 0;
    const TP = 1.0, SL = 1.5;

    for (let i = 100; i < allM1Candles.length - 30; i++) {
        const c = allM1Candles[i];
        const hour = new Date(c.epoch * 1000).getUTCHours();

        // FILTRO DE SESIÓN (LONDRES + NY: 08:00 - 20:00 UTC)
        if (hour < 8 || hour > 20) continue;

        let entryType = null;

        // Lógica de Compra (Call)
        if (smaF[i] > smaS[i] && allM1Candles[i].low <= smaS[i] * 1.0001) {
            if (!arch.rsiFilter || (rsi[i] < 60)) {
                entryType = 'CALL';
            }
        }
        // Lógica de Venta (Put)
        else if (smaF[i] < smaS[i] && allM1Candles[i].high >= smaS[i] * 0.9999) {
            if (!arch.rsiFilter || (rsi[i] > 40)) {
                entryType = 'PUT';
            }
        }

        if (entryType) {
            let res = simTrade(i, entryType, TP, SL);
            pnl += res;
            if (res > 0) wins++; else losses++;
            i += 20; // Cooldown post-trade
        }
    }

    let pf = (losses > 0) ? (Math.abs(wins * TP) / Math.abs(losses * SL)) : wins;
    return { pnl, wins, losses, pf };
}

function simTrade(idx, type, tp, sl) {
    let entry = allM1Candles[idx + 1]?.open || allM1Candles[idx].close;
    for (let j = idx + 1; j < idx + 30 && j < allM1Candles.length; j++) {
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
    return -sl * 0.3; // Salida por tiempo
}
