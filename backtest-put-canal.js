const WebSocket = require('ws');

const APP_ID = 1089;
const SYMBOL = 'frxXAUUSD';
const TIMEFRAME = 3600; // H1

const endTS = Math.floor(Date.now() / 1000);
const startTS = endTS - (60 * 24 * 60 * 60);

const STAKE = 10;
const MULTIPLIER = 40;
const TP = 3.0;
const SL = 1.5;

console.log(`\n📉 ANALIZANDO: ESTRATEGIA PUT EN CANAL BAJISTA (ORO - H1)`);
console.log(`==========================================================`);
console.log(`Lógica: Alcance de Techo + Ruptura de Piso Interno`);
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
        runPutCanalSimulation(candles);
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

function runPutCanalSimulation(candles) {
    const sma20 = calculateSMA(candles, 20);
    const sma40 = calculateSMA(candles, 40);

    let balance = 0, wins = 0, losses = 0, total = 0;
    let setupActive = false;
    let internalLows = [];

    for (let i = 40; i < candles.length - 1; i++) {
        const c = candles[i];
        const s20 = sma20[i];
        const s40 = sma40[i];

        // 1. CONDICIÓN: Canal Bajista (SMA40 > SMA20)
        if (s40 > s20) {

            // 2. SETUP: El precio se acerca al "Techo" (al SMA40)
            if (c.high >= s40 * 0.999 && c.high <= s40 * 1.01) {
                setupActive = true;
                internalLows = []; // Empezamos a trazar el "piso" de la subida
                continue;
            }

            if (setupActive) {
                // Registramos mínimos locales de la subida para el "piso"
                if (candles[i - 1] && candles[i + 1] && c.low < candles[i - 1].low && c.low < candles[i + 1].low) {
                    internalLows.push({ index: i, low: c.low });
                }

                // 3. GATILLO: Ruptura del piso interno por una vela roja
                if (internalLows.length >= 2) {
                    const l1 = internalLows[0];
                    const l2 = internalLows[internalLows.length - 1];

                    // Solo si los mínimos son crecientes (subida interna)
                    if (l2.low > l1.low) {
                        const slope = (l2.low - l1.low) / (l2.index - l1.index);
                        const floorLineValue = l2.low + slope * (i - l2.index);

                        if (c.close < floorLineValue && c.close < c.open) {
                            total++;
                            const res = simulate(candles, i + 1);
                            if (res > 0) wins++; else losses++;
                            balance += res;
                            setupActive = false;
                            i += 10; // Cooldown
                        }
                    }
                }

                // Si el precio se aleja demasiado hacia arriba, invalidamos el canal
                if (c.close > s40 * 1.02) setupActive = false;
            }
        } else {
            setupActive = false;
        }
    }

    const wr = (wins / total) * 100 || 0;
    console.log(`🏆 RESULTADOS PUT EN CANAL (60 DÍAS):`);
    console.log(`--------------------------------------------------`);
    console.log(`Operaciones Totales: ${total}`);
    console.log(`Victorias: ${wins} ✅`);
    console.log(`Derrotas: ${losses} ❌`);
    console.log(`Win Rate: ${wr.toFixed(1)}%`);
    console.log(`PnL Total: $${balance.toFixed(2)}`);
    console.log(`--------------------------------------------------\n`);
}

function simulate(candles, start) {
    if (!candles[start]) return 0;
    const entry = candles[start].open;
    for (let j = start; j < Math.min(start + 50, candles.length); j++) {
        const h = candles[j].high;
        const l = candles[j].low;
        // Buscamos caida (es un PUT)
        const profit = ((entry - l) / entry) * MULTIPLIER * STAKE;
        const loss = ((entry - h) / entry) * MULTIPLIER * STAKE;

        if (profit >= TP) return TP;
        if (loss <= -SL) return -SL;
    }
    return 0;
}
