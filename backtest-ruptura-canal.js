const WebSocket = require('ws');

const APP_ID = 1089;
const SYMBOL = 'frxXAUUSD';
const TIMEFRAME = 3600; // H1 (Como pide la estrategia)

const endTS = Math.floor(Date.now() / 1000);
const startTS = endTS - (60 * 24 * 60 * 60); // ANALIZAREMOS 60 DÍAS PARA TENER MÁS CANALES

const STAKE = 10;
const MULTIPLIER = 40;
const TP = 5.0; // Profit más largo para cambios de tendencia
const SL = 2.5;

let allCandles = [];

console.log(`\n📉 ANALIZANDO: RUPTURA DE CANAL BAJISTA (ORO - H1)`);
console.log(`==========================================================`);
console.log(`Lógica: SMA40 > SMA20 + Ruptura de Línea de Tendencia`);
console.log(`Periodo: Últimos 60 días | Marco: 1 Hora`);
console.log(`==========================================================\n`);

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

ws.on('open', () => {
    ws.send(JSON.stringify({
        ticks_history: SYMBOL,
        end: 'latest',
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
        console.log(`📊 Datos cargados: ${candles.length} velas analizadas.`);
        runRupturaCanalSimulation(candles);
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

function runRupturaCanalSimulation(candles) {
    const sma20 = calculateSMA(candles, 20);
    const sma40 = calculateSMA(candles, 40);

    let balance = 0, wins = 0, losses = 0, total = 0;
    let localHighs = [];

    for (let i = 40; i < candles.length - 1; i++) {
        const c = candles[i];
        const s20 = sma20[i];
        const s40 = sma40[i];

        // DETECCIÓN DE PICOS PARA LA LÍNEA (TECHO)
        if (candles[i - 1] && candles[i + 1]) {
            if (candles[i].high > candles[i - 1].high && candles[i].high > candles[i + 1].high) {
                localHighs.push({ index: i, high: candles[i].high });
                if (localHighs.length > 5) localHighs.shift();
            }
        }

        // CONDICIÓN 1: Canal Bajista (SMA40 > SMA20)
        if (s40 > s20 && localHighs.length >= 2) {
            const h1 = localHighs[localHighs.length - 2];
            const h2 = localHighs[localHighs.length - 1];

            // Solo si son máximos decrecientes (Canal Bajista Real)
            if (h1.high > h2.high) {
                // Cálculo simplificado de la línea de tendencia entre dos picos
                const slope = (h2.high - h1.high) / (h2.index - h1.index);
                const trendlineValue = h2.high + slope * (i - h2.index);

                // CONDICIÓN 3: Ruptura del techo con vela alcista
                if (c.close > trendlineValue && candles[i - 1].close < trendlineValue) {
                    total++;
                    const res = simulate(candles, i + 1);
                    if (res > 0) wins++; else losses++;
                    balance += res;
                    i += 24; // Cooldown de 1 día tras ruptura
                    localHighs = []; // Reset de línea
                }
            }
        }
    }

    const wr = (wins / total) * 100 || 0;
    console.log(`🏆 RESULTADOS RUPTURA DE CANAL (60 DÍAS):`);
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
