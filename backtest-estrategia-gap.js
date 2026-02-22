const WebSocket = require('ws');

const APP_ID = 1089;
const SYMBOL = 'frxXAUUSD';
const TIMEFRAME = 3600; // H1

const endTS = Math.floor(Date.now() / 1000);
const startTS = endTS - (90 * 24 * 60 * 60); // ANALIZAREMOS 3 MESES

const STAKE = 10;
const MULTIPLIER = 40;
const TP = 4.0;
const SL = 2.0;

console.log(`\n🚀 ANALIZANDO: ESTRATEGIA GAP NORMAL AL ALZA (ORO - H1)`);
console.log(`==========================================================`);
console.log(`Lógica: Salto de Precio + 2 Velas Verdes + Después 11:00 AM`);
console.log(`Periodo: Últimos 90 días | Marco: 1 Hora`);
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
        runGapSimulation(candles);
        ws.close();
    }
});

function runGapSimulation(candles) {
    let balance = 0, wins = 0, losses = 0, total = 0;

    for (let i = 2; i < candles.length - 1; i++) {
        const prevCandle = candles[i - 1];
        const currentCandle = candles[i];
        const nextCandle = candles[i + 1];

        // 1. Detectar Gap (Discontinuidad)
        const gapSize = currentCandle.open - prevCandle.close;
        const isGapUp = gapSize > (prevCandle.close * 0.0003); // Salto apreciable

        if (isGapUp) {
            // 2. Filtro Horario: 11:00 AM NY (aprox 15:00 UTC-16:00 UTC)
            const date = new Date(currentCandle.epoch * 1000);
            const hourUTC = date.getUTCHours();
            const after11AM = hourUTC >= 15;

            if (after11AM) {
                // 3. Confirmación: 2 Velas Verdes (la del gap y la siguiente)
                const firstGreen = currentCandle.close > currentCandle.open;
                const secondGreen = nextCandle.close > nextCandle.open;

                if (firstGreen && secondGreen) {
                    total++;
                    const res = simulate(candles, i + 2);
                    if (res > 0) wins++; else losses++;
                    balance += res;
                    i += 10; // Evitar señales duplicadas en el mismo gap
                }
            }
        }
    }

    const wr = (wins / total) * 100 || 0;
    console.log(`🏆 RESULTADOS ESTRATEGIA GAP (90 DÍAS):`);
    console.log(`--------------------------------------------------`);
    console.log(`Operaciones Totales: ${total}`);
    console.log(`Victorias: ${wins} ✅`);
    console.log(`Derrotas: ${losses} ❌`);
    console.log(`Win Rate: ${wr.toFixed(1)}%`);
    console.log(`PnL Total: $${balance.toFixed(2)}`);
    console.log(`--------------------------------------------------\n`);
    console.log(`Nota: En el Oro, los Gaps son raros pero extremadamente potentes.`);
}

function simulate(candles, start) {
    if (!candles[start]) return 0;
    const entry = candles[start].open;
    for (let j = start; j < Math.min(start + 24, candles.length); j++) {
        const p = ((candles[j].high - entry) / entry) * MULTIPLIER * STAKE;
        const lo = ((candles[j].low - entry) / entry) * MULTIPLIER * STAKE;
        if (p >= TP) return TP;
        if (lo <= -SL) return -SL;
    }
    return 0;
}
