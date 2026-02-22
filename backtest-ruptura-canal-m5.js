const WebSocket = require('ws');

const APP_ID = 1089;
const SYMBOL = 'frxXAUUSD';
const TIMEFRAME = 300; // M5 (5 Minutos)

const endTS = Math.floor(Date.now() / 1000);
const startTS = endTS - (15 * 24 * 60 * 60); // ANALIZAREMOS 15 DÍAS (Más rápido)

const STAKE = 10;
const MULTIPLIER = 40;
const TP = 1.0;
const SL = 0.50;

let allCandles = [];
let nextEnd = endTS;

console.log(`\n📉 ANALIZANDO M5 (15 DÍAS): RUPTURA DE CANAL BAJISTA (ORO)`);
console.log(`==========================================================`);

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

ws.on('open', () => {
    console.log("📡 Conectado a Deriv. Pidiendo velas...");
    fetchBatch();
});

function fetchBatch() {
    ws.send(JSON.stringify({
        ticks_history: SYMBOL,
        end: 'latest',
        start: startTS,
        count: 5000, // Máximo por llamada
        granularity: TIMEFRAME,
        style: 'candles'
    }));
}

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.error) {
        console.error("❌ Error API:", msg.error.message);
        process.exit(1);
    }
    if (msg.msg_type === 'candles') {
        const candles = msg.candles || [];
        console.log(`📥 Recibidas ${candles.length} velas.`);
        if (candles.length > 0) {
            runRupturaSimulation(candles);
        } else {
            console.log("⚠️ No se encontraron velas en este periodo.");
        }
        ws.close();
    }
});

function calculateSMA(data, period) {
    let smas = new Array(data.length).fill(null);
    for (let i = period - 1; i < data.length; i++) {
        let sum = 0;
        for (let j = 0; j < period; j++) sum += data[i - j].close;
        smas[i] = sum / period;
    }
    return smas;
}

function runRupturaSimulation(candles) {
    const sma20 = calculateSMA(candles, 20);
    const sma40 = calculateSMA(candles, 40);

    let balance = 0, wins = 0, losses = 0, total = 0;
    let localHighs = [];

    for (let i = 40; i < candles.length - 1; i++) {
        const c = candles[i];
        const s20 = sma20[i];
        const s40 = sma40[i];

        // Detección de picos
        if (candles[i - 1] && candles[i + 1]) {
            if (c.high > candles[i - 1].high && c.high > candles[i + 1].high) {
                localHighs.push({ index: i, high: c.high });
                if (localHighs.length > 5) localHighs.shift();
            }
        }

        // Canal Bajista
        if (s40 > s20 && localHighs.length >= 2) {
            const h1 = localHighs[localHighs.length - 2];
            const h2 = localHighs[localHighs.length - 1];

            if (h1.high > h2.high) {
                const slope = (h2.high - h1.high) / (h2.index - h1.index);
                const trendlineValue = h2.high + slope * (i - h2.index);

                if (c.close > trendlineValue && candles[i - 1].close < trendlineValue) {
                    total++;
                    const res = simulate(candles, i + 1);
                    if (res > 0) wins++; else losses++;
                    balance += res;
                    i += 20; // Cooldown
                    localHighs = [];
                }
            }
        }
    }

    const wr = (wins / total) * 100 || 0;
    console.log(`\n🏆 RESULTADOS RUPTURA CANAL (M5 - 15 DÍAS):`);
    console.log(`--------------------------------------------------`);
    console.log(`Operaciones Totales: ${total}`);
    console.log(`Victorias: ${wins} ✅`);
    console.log(`Derrotas: ${losses} ❌`);
    console.log(`Win Rate: ${wr.toFixed(1)}%`);
    console.log(`PnL Total: $${balance.toFixed(2)}`);
    console.log(`--------------------------------------------------\n`);
}

function simulate(candles, start) {
    const entry = candles[start].open;
    for (let j = start; j < candles.length; j++) {
        const p = ((candles[j].high - entry) / entry) * MULTIPLIER * STAKE;
        const lo = ((candles[j].low - entry) / entry) * MULTIPLIER * STAKE;
        if (p >= TP) return TP;
        if (lo <= -SL) return -SL;
    }
    return 0;
}
