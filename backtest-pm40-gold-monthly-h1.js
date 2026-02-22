const WebSocket = require('ws');

const APP_ID = 1089;
const SYMBOL = 'frxXAUUSD';
const TIMEFRAME = 3600; // UNA HORA (H1) - IGUAL QUE EN TU FOTO

const endTS = Math.floor(Date.now() / 1000);
const startTS = endTS - (30 * 24 * 60 * 60); // 30 Días

const SMA_20_PERIOD = 20;
const SMA_40_PERIOD = 40;
const STAKE = 10;
const MULTIPLIER = 40;
const TP = 2.0;
const SL = 2.0;

let allCandles = [];

console.log(`\n🥇 BACKTEST MENSUAL (H1): ESTRATEGIA PM-40 (ORO)`);
console.log(`==========================================================`);
console.log(`Periodo: Últimos 30 días | Gráfico: H1 (1 Hora)`);
console.log(`Ratio: 1:1 ($2.00 / $2.00)`);
console.log(`Lógica: PM20 > PM40 + Pulback a SMA40 + Ruptura de Máximo`);
console.log(`==========================================================\n`);

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

ws.on('open', () => {
    ws.send(JSON.stringify({
        ticks_history: SYMBOL,
        end: 'latest',
        start: startTS,
        count: 1000,
        granularity: TIMEFRAME,
        style: 'candles'
    }));
});

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.msg_type === 'candles') {
        const candles = msg.candles;
        console.log(`📊 Datos cargados: ${candles.length} velas de 1 hora analizadas.`);
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
            if (c.low <= s40 * 1.002) {
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
                    i += 5; // Cooldown (5 horas)
                } else {
                    if (c.high < resistance) resistance = c.high;
                    if (c.close < s40 * 0.995) setup = false;
                }
            }
        } else {
            setup = false;
        }
    }

    const wr = (wins / total) * 100 || 0;
    console.log(`🏆 RESULTADOS FINALES DEL MES (H1):`);
    console.log(`--------------------------------------------------`);
    console.log(`Operaciones: ${total}`);
    console.log(`Victorias: ${wins} ✅`);
    console.log(`Derrotas: ${losses} ❌`);
    console.log(`Win Rate: ${wr.toFixed(1)}%`);
    console.log(`PnL Mensual Neto: $${balance.toFixed(2)}`);
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
