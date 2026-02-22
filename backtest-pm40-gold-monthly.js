const WebSocket = require('ws');

const APP_ID = 1089;
const SYMBOL = 'frxXAUUSD';
const TIMEFRAME = 60; // M1

const endTS = Math.floor(Date.now() / 1000); // Hasta ahora
const startTS = endTS - (30 * 24 * 60 * 60);

const SMA_20_PERIOD = 20;
const SMA_40_PERIOD = 40;
const STAKE = 10;
const MULTIPLIER = 40;
const TP = 1.0;
const SL = 2.0;

let allCandles = [];
let nextEnd = endTS;

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

ws.on('open', () => fetchBatch());

function fetchBatch() {
    ws.send(JSON.stringify({
        ticks_history: SYMBOL,
        end: nextEnd,
        start: startTS,
        count: 5000,
        granularity: TIMEFRAME,
        style: 'candles'
    }));
}

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.msg_type === 'candles') {
        const candles = msg.candles;
        if (candles.length > 0) {
            allCandles = candles.concat(allCandles);
            nextEnd = candles[0].epoch - 1;

            console.log(`📥 Cargando historial... (${allCandles.length} velas recuperadas)`);

            if (nextEnd > startTS && candles.length === 5000) {
                fetchBatch();
            } else {
                console.log(`✅ Carga completa. Analizando 1 mes de trading...`);
                runSimulation(allCandles);
                ws.close();
            }
        } else {
            runSimulation(allCandles);
            ws.close();
        }
    }
});

function calculateSMA(data, period) {
    let smas = new Array(data.length).fill(null);
    for (let i = period - 1; i < data.length; i++) {
        let sum = 0;
        for (let j = 0; j < period; j++) {
            sum += data[i - j].close;
        }
        smas[i] = sum / period;
    }
    return smas;
}

function runSimulation(candles) {
    // Ordenar por tiempo ascendente si es necesario
    candles.sort((a, b) => a.epoch - b.epoch);

    const sma20 = calculateSMA(candles, SMA_20_PERIOD);
    const sma40 = calculateSMA(candles, SMA_40_PERIOD);

    let balance = 0, wins = 0, losses = 0, total = 0;
    let setup = false, resistance = 0;

    for (let i = SMA_40_PERIOD; i < candles.length - 1; i++) {
        const c = candles[i];
        const s20 = sma20[i];
        const s40 = sma40[i];

        if (s20 > s40) {
            if (c.low <= s40 * 1.0002) {
                setup = true;
                resistance = c.high;
                continue;
            }

            if (setup) {
                if (c.close > resistance) {
                    total++;
                    const res = simulate(candles, i + 1);
                    if (res > 0) wins++; else losses++;
                    balance += res;
                    setup = false;
                    i += 30; // Cooldown más prudente para un mes
                } else {
                    if (c.high < resistance) resistance = c.high;
                    if (c.close < s40 * 0.998) setup = false;
                }
            }
        } else {
            setup = false;
        }
    }

    const wr = (wins / total) * 100 || 0;
    console.log(`\n🏆 RESULTADOS FINALES DE 1 MES (ORO):`);
    console.log(`==========================================================`);
    console.log(`   Periodo Analizado: ${((candles[candles.length - 1].epoch - candles[0].epoch) / (24 * 60 * 60)).toFixed(1)} días`);
    console.log(`   Velas Totales: ${candles.length}`);
    console.log(`   Operaciones: ${total}`);
    console.log(`   Victorias: ${wins} ✅`);
    console.log(`   Derrotas: ${losses} ❌`);
    console.log(`   Win Rate: ${wr.toFixed(1)}%`);
    console.log(`   PnL Mensual: $${balance.toFixed(2)}`);
    console.log(`   ROI esperado (Stake $10): ${((balance / 10) * 100).toFixed(1)}%`);
    console.log(`==========================================================\n`);
}

function simulate(candles, start) {
    const entry = candles[start].open;
    for (let j = start; j < candles.length; j++) {
        const h = candles[j].high;
        const l = candles[j].low;
        const p = ((h - entry) / entry) * MULTIPLIER * STAKE;
        const lo = ((l - entry) / entry) * MULTIPLIER * STAKE;

        if (p >= TP) return TP;
        if (lo <= -SL) return -SL;
    }
    return 0;
}
