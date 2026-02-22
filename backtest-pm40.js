const WebSocket = require('ws');

const APP_ID = 1089;
const SYMBOL = 'R_100';
const days = 1;
const hours = days * 24;
const endTime = Math.floor(Date.now() / 1000);
const startTime = endTime - (hours * 60 * 60);

// CONFIGURACIÓN DE LA ESTRATEGIA PM-40
const TIMEFRAME = 60; // Velas de 1 minuto (M1) para mercados rápidos
const SMA_20_PERIOD = 20;
const SMA_40_PERIOD = 40;

const STAKE = 10;
const MULTIPLIER = 40;
const TP = 1.0; // Profit objetivo
const SL = 2.0; // Stop Loss

let allCandles = [];

console.log(`\n🕵️ BACKTEST: ESTRATEGIA PM-40 (V100 - Últimas 24h)`);
console.log(`==========================================================`);
console.log(`Gráfico: ${SYMBOL} | Velas: M5 (5 minutos)`);
console.log(`Filtro: PM-20 > PM-40 | Gatillo: Toque PM-40 + Ruptura de máximo anterior`);
console.log(`==========================================================\n`);

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

ws.on('open', () => {
    ws.send(JSON.stringify({
        ticks_history: SYMBOL,
        end: 'latest',
        start: startTime,
        granularity: TIMEFRAME,
        style: 'candles'
    }));
});

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.msg_type === 'candles') {
        const candles = msg.candles;
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

    // Variables para el setup
    let trendlineActive = false;
    let highAfterTouch = 0;

    for (let i = SMA_40_PERIOD; i < candles.length - 1; i++) {
        const c = candles[i];
        const s20 = sma20[i];
        const s40 = sma40[i];

        // 1) PM-20 sobre PM-40 (Tendencia Alcista)
        if (s20 > s40) {

            // 2 y 3) Caída de precios y visita al PM-40
            // Si el precio bajo de la vela toca o está muy cerca de la SMA 40
            if (c.low <= s40 * 1.0005) {
                trendlineActive = true;
                highAfterTouch = c.high; // Guardamos el máximo de la vela que tocó
                continue;
            }

            // 4 y 5) Ruptura del "techo" (Máximo de la vela de caída)
            if (trendlineActive) {
                if (c.close > highAfterTouch) {
                    // DISPARO CALL (Simulamos entrada en la siguiente vela)
                    total++;
                    const result = simulateTrade(candles, i + 1);
                    if (result > 0) wins++; else losses++;
                    balance += result;
                    trendlineActive = false; // Reset setup
                    i += 10; // Cooldown para no entrar en la misma tendencia de inmediato
                } else {
                    // Si el precio sigue bajando, actualizamos el techo (línea bajista)
                    if (c.high < highAfterTouch) highAfterTouch = c.high;
                }
            }
        } else {
            trendlineActive = false;
        }
    }

    const wr = (wins / total) * 100 || 0;
    console.log(`🏆 RESULTADOS PM-40:`);
    console.log(`--------------------------------------------------`);
    console.log(`Operaciones: ${total}`);
    console.log(`Victorias: ${wins} ✅`);
    console.log(`Derrotas: ${losses} ❌`);
    console.log(`Win Rate: ${wr.toFixed(1)}%`);
    console.log(`PnL Neto: $${balance.toFixed(2)}`);
    console.log(`Nota: Basado en Multiplicadores 40x con TP $1 / SL $2`);
    console.log(`--------------------------------------------------\n`);
}

// Simulación simplificada de Profit/Loss para velas
function simulateTrade(candles, startIndex) {
    const entryPrice = candles[startIndex].open;
    for (let j = startIndex; j < candles.length; j++) {
        const high = candles[j].high;
        const low = candles[j].low;

        // Simulación de profit con Multiplier 40x
        const profitHigh = ((high - entryPrice) / entryPrice) * MULTIPLIER * STAKE;
        const lossLow = ((low - entryPrice) / entryPrice) * MULTIPLIER * STAKE;

        if (profitHigh >= TP) return TP;
        if (lossLow <= -SL) return -SL;
    }
    return 0; // Trade no cerrado al final del historial
}
