const WebSocket = require('ws');

const APP_ID = 1089;
const SYMBOL = 'frxXAUUSD';

// MIÉRCOLES DE LA SEMANA PASADA (18 DE FEBRERO DE 2026)
const startTS = Math.floor(new Date('2026-02-18T00:00:00Z').getTime() / 1000);
const endTS = Math.floor(new Date('2026-02-18T23:59:59Z').getTime() / 1000);

const TIMEFRAME = 60; // M1
const SMA_20_PERIOD = 20;
const SMA_40_PERIOD = 40;
const STAKE = 10;
const MULTIPLIER = 40;
const TP = 1.0;
const SL = 2.0;

let allCandles = [];

console.log(`\n🥇 BACKTEST DETALLADO: MIÉRCOLES 18 DE FEBRERO (ORO)`);
console.log(`==========================================================`);
console.log(`Periodo: 24 Horas Completas`);
console.log(`Estrategia: PM-40 | Velas: M1`);
console.log(`Configuración: TP $1.00 / SL $2.00`);
console.log(`==========================================================\n`);

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

ws.on('open', () => {
    ws.send(JSON.stringify({
        ticks_history: SYMBOL,
        end: endTS,
        start: startTS,
        count: 5000,
        granularity: TIMEFRAME,
        style: 'candles'
    }));
});

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.msg_type === 'candles') {
        const candles = msg.candles;
        if (!candles || candles.length === 0) {
            console.log("❌ Datos no disponibles para este día.");
            process.exit(1);
        }
        console.log(`📊 Datos cargados: ${candles.length} velas analizadas.`);
        runPM40Simulation(candles);
        ws.close();
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

function runPM40Simulation(candles) {
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
                    i += 15;
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
    console.log(`🏆 RESULTADOS DEL MIÉRCOLES 18/FEB:`);
    console.log(`--------------------------------------------------`);
    console.log(`Operaciones Totales: ${total}`);
    console.log(`Victorias: ${wins} ✅`);
    console.log(`Derrotas: ${losses} ❌`);
    console.log(`Win Rate: ${wr.toFixed(1)}%`);
    console.log(`PnL del Día: $${balance.toFixed(2)}`);
    console.log(`--------------------------------------------------\n`);
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
