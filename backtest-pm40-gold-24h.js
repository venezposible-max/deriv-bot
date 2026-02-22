const WebSocket = require('ws');

const APP_ID = 1089;
const SYMBOL = 'frxXAUUSD';

// USAMOS JUEVES 19 DE FEBRERO PARA TENER 24 HORAS COMPLETAS DE MERCADO ABIERTO
const startTS = Math.floor(new Date('2026-02-19T00:00:00Z').getTime() / 1000);
const endTS = Math.floor(new Date('2026-02-19T23:59:59Z').getTime() / 1000);

// CONFIGURACIÓN PM-40 (ESTRICTA SEGÚN GRÁFICOS)
const TIMEFRAME = 60; // Probamos con M1 (1 minuto) para mas datos en 24h
const SMA_20_PERIOD = 20;
const SMA_40_PERIOD = 40;

const STAKE = 10;
const MULTIPLIER = 40;
const TP = 1.0;
const SL = 2.0;

console.log(`\n🥇 BACKTEST 24H: ESTRATEGIA PM-40 (ORO - XAU/USD)`);
console.log(`==========================================================`);
console.log(`Periodo: Jueves 19/Feb (Historial Completo)`);
console.log(`Velas: M1 (1 minuto) | Ratio: 1:2 ($1.00 / $2.00)`);
console.log(`Lógica: PM20 > PM40 + Pulback a SMA40 + Ruptura de 'Techo'`);
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
        if (!candles || candles.length < SMA_40_PERIOD) {
            console.log("❌ Error: No se recibieron suficientes velas.");
            process.exit(1);
        }
        console.log(`📊 Datos cargados: ${candles.length} velas (1.440 esperadas).`);
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
    let setupActive = false;
    let entryResistance = 0; // El "techo" que debe romper

    for (let i = SMA_40_PERIOD; i < candles.length - 1; i++) {
        const c = candles[i];
        const s20 = sma20[i];
        const s40 = sma40[i];

        // REGLA 1: PM-20 sobre PM-40 (Tendencia alcista)
        if (s20 > s40) {

            // REGLAS 2 y 3: Caída y visita al PM-40
            if (c.low <= s40 * 1.0002) { // Toque o cercanía extrema
                setupActive = true;
                entryResistance = c.high; // Definimos el techo inicial
                continue;
            }

            // REGLAS 4 y 5: Ruptura de techo con vela alcista
            if (setupActive) {
                if (c.close > entryResistance) {
                    // ¡DISPARO!
                    total++;
                    const outcome = simulateTrade(candles, i + 1);
                    if (outcome > 0) wins++; else losses++;
                    balance += outcome;
                    setupActive = false; // Reset
                    i += 15; // Cooldown para esperar nueva formación
                } else {
                    // Actualizamos la línea bajista (Trailing resistance)
                    // Si la vela es más baja, el "techo" baja
                    if (c.high < entryResistance) entryResistance = c.high;

                    // Si el precio se desploma muy por debajo de la SMA40, invalidamos
                    if (c.close < s40 * 0.998) setupActive = false;
                }
            }
        } else {
            setupActive = false;
        }
    }

    const wr = (wins / total) * 100 || 0;
    console.log(`🏆 RESULTADOS FINALES 24H:`);
    console.log(`--------------------------------------------------`);
    console.log(`Operaciones: ${total}`);
    console.log(`Victorias: ${wins} ✅`);
    console.log(`Derrotas: ${losses} ❌`);
    console.log(`Win Rate: ${wr.toFixed(1)}%`);
    console.log(`PnL Neto: $${balance.toFixed(2)}`);
    console.log(`--------------------------------------------------\n`);
}

function simulateTrade(candles, startIndex) {
    const entryPrice = candles[startIndex].open;
    for (let j = startIndex; j < candles.length; j++) {
        const h = candles[j].high;
        const l = candles[j].low;
        const prof = ((h - entryPrice) / entryPrice) * MULTIPLIER * STAKE;
        const loss = ((l - entryPrice) / entryPrice) * MULTIPLIER * STAKE;

        if (prof >= TP) return TP;
        if (loss <= -SL) return -SL;
    }
    return 0; // No cerró
}
