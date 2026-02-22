const WebSocket = require('ws');

const APP_ID = 1089;
const SYMBOL = 'R_100';
const days = 1;
const hours = days * 24;
const endTime = Math.floor(Date.now() / 1000);
const startTime = endTime - (hours * 60 * 60);

// CONFIGURACIÓN DE LA ESTRATEGIA PM-40 (PROFESIONAL)
const TIMEFRAME = 60; // M1
const SMA_20_PERIOD = 20;
const SMA_40_PERIOD = 40;

const STAKE = 10;
const MULTIPLIER = 40;
const TP = 1.0;
const SL = 1.0; // AJUSTAMOS A 1:1 PARA PROBAR RENTABILIDAD CON 60% WR

let allCandles = [];

console.log(`\n🕵️ BACKTEST SEMANAL: ESTRATEGIA PM-40 (V100)`);
console.log(`==========================================================`);
console.log(`Periodo: 7 Días | Velas: M1`);
console.log(`Configuración: TP $${TP} / SL $${SL} (Ratio 1:1)`);
console.log(`Lógica: Tendencia Alcista + Toque SMA40 + Ruptura de Techo`);
console.log(`==========================================================\n`);

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

ws.on('open', () => fetchBatch());

function fetchBatch(end = 'latest') {
    ws.send(JSON.stringify({
        ticks_history: SYMBOL,
        end: end,
        start: startTime,
        count: 10000,
        granularity: TIMEFRAME,
        style: 'candles'
    }));
}

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.msg_type === 'candles') {
        allCandles = msg.candles;
        console.log(`📊 Datos cargados: ${allCandles.length} velas.`);
        runPM40Simulation(allCandles);
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
    let trendlineActive = false;
    let highAfterTouch = 0;

    for (let i = SMA_40_PERIOD; i < candles.length - 1; i++) {
        const c = candles[i];
        const s20 = sma20[i];
        const s40 = sma40[i];

        if (s20 > s40) {
            // Toque SMA40
            if (c.low <= s40 * 1.001) {
                trendlineActive = true;
                highAfterTouch = c.high;
                continue;
            }

            // Ejecución por ruptura de máximo de vela de caída
            if (trendlineActive) {
                if (c.close > highAfterTouch) {
                    total++;
                    const result = simulateTrade(candles, i + 1);
                    if (result > 0) wins++; else losses++;
                    balance += result;
                    trendlineActive = false;
                    i += 15; // Cooldown
                } else {
                    if (c.high < highAfterTouch && c.high > s40) highAfterTouch = c.high;
                    // Si el precio cae por debajo de la SMA40 demasiado, invalidamos el setup
                    if (c.close < s40 * 0.998) trendlineActive = false;
                }
            }
        } else {
            trendlineActive = false;
        }
    }

    const wr = (wins / total) * 100 || 0;
    console.log(`🏆 RESULTADOS FINALES (7 DÍAS):`);
    console.log(`--------------------------------------------------`);
    console.log(`Operaciones Totales: ${total}`);
    console.log(`Victorias: ${wins} ✅`);
    console.log(`Derrotas: ${losses} ❌`);
    console.log(`Win Rate: ${wr.toFixed(1)}%`);
    console.log(`PnL Neto: $${balance.toFixed(2)}`);
    console.log(`--------------------------------------------------\n`);
}

function simulateTrade(candles, startIndex) {
    const entryPrice = candles[startIndex].open;
    for (let j = startIndex; j < candles.length; j++) {
        const high = candles[j].high;
        const low = candles[j].low;
        const profitHigh = ((high - entryPrice) / entryPrice) * MULTIPLIER * STAKE;
        const lossLow = ((low - entryPrice) / entryPrice) * MULTIPLIER * STAKE;

        if (profitHigh >= TP) return TP;
        if (lossLow <= -SL) return -SL;
    }
    return 0;
}
