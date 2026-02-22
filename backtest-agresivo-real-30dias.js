const WebSocket = require('ws');

const APP_ID = 1089;
const SYMBOL = 'frxXAUUSD';
const MULTIPLIER = 40;
const TP_PCT = 0.10;
const SL_PCT = 0.20;

const DAYS_TO_BACKTEST = 30;
const endTS = Math.floor(Date.now() / 1000);
const startTS = endTS - (DAYS_TO_BACKTEST * 24 * 60 * 60);

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

let allM1Candles = [];
let allH1Candles = [];
let targetStart = startTS;

console.log(`\n💎 BACKTEST REAL 30 DÍAS (AGRESIVO): ORO`);
console.log(`==========================================================`);
console.log(`Fecha inicio: ${new Date(startTS * 1000).toLocaleDateString()}`);
console.log(`Fecha fin: ${new Date(endTS * 1000).toLocaleDateString()}`);
console.log(`Cargando datos por bloques...`);

ws.on('open', () => {
    fetchChunks();
});

function fetchChunks() {
    // Pedir H1 de todo el mes (son pocas velas, ~720)
    ws.send(JSON.stringify({
        ticks_history: SYMBOL,
        end: 'latest',
        start: startTS,
        count: 5000,
        granularity: 3600,
        style: 'candles'
    }));

    // Pedir M1 en el primer bloque
    requestM1(endTS);
}

function requestM1(beforeTS) {
    ws.send(JSON.stringify({
        ticks_history: SYMBOL,
        end: beforeTS,
        count: 5000,
        granularity: 60,
        style: 'candles',
        req_id: 1 // Usamos req_id para rastrear
    }));
}

ws.on('message', (data) => {
    const msg = JSON.parse(data);

    if (msg.msg_type === 'candles') {
        if (msg.echo_req.granularity === 3600) {
            allH1Candles = msg.candles || [];
        } else if (msg.echo_req.granularity === 60) {
            const received = msg.candles || [];
            allM1Candles = received.concat(allM1Candles);

            const earliest = received[0]?.epoch;
            if (earliest && earliest > startTS && received.length === 5000) {
                // Seguir pidiendo hacia atrás
                requestM1(earliest - 1);
            } else {
                // Terminamos de cargar
                console.log(`✅ Datos cargados: ${allM1Candles.length} velas M1 encontradas.`);
                runAggressiveBacktest();
                ws.close();
            }
        }
    }
});

function calculateSMA(prices, period) {
    let smas = new Array(prices.length).fill(null);
    for (let i = period - 1; i < prices.length; i++) {
        let sum = 0;
        for (let j = 0; j < period; j++) sum += prices[i - j];
        smas[i] = sum / period;
    }
    return smas;
}

function runAggressiveBacktest() {
    // Ordenar por tiempo
    allM1Candles.sort((a, b) => a.epoch - b.epoch);
    allH1Candles.sort((a, b) => a.epoch - b.epoch);

    const m1Closes = allM1Candles.map(c => c.close);
    const m1S20 = calculateSMA(m1Closes, 20);
    const m1S40 = calculateSMA(m1Closes, 40);
    const h1Closes = allH1Candles.map(c => c.close);
    const h1S20 = calculateSMA(h1Closes, 20);
    const h1S40 = calculateSMA(h1Closes, 40);

    let balance = 10.00;
    let maxBalance = 10.00;
    let dayMap = {};

    allM1Candles.forEach((c, i) => {
        const date = new Date(c.epoch * 1000).toISOString().split('T')[0];
        if (!dayMap[date]) dayMap[date] = [];
        dayMap[date].push({ candle: c, index: i });
    });

    console.log(`\n📊 PROGRESIÓN REAL DÍA A DÍA:`);
    console.log(`--------------------------------------------------`);

    Object.keys(dayMap).sort().forEach(date => {
        let dayWins = 0, dayLosses = 0;
        let setup = false, resistance = 0;

        for (const event of dayMap[date]) {
            const i = event.index;
            const c = event.candle;
            if (balance < 1) break;

            // Filtro H1
            const h1C = allH1Candles.findLast(h => h.epoch <= c.epoch);
            const h1Idx = allH1Candles.indexOf(h1C);
            let h1TrendUp = h1Idx >= 40 ? h1S20[h1Idx] > h1S40[h1Idx] : true;

            if (m1S20[i] > m1S40[i] && h1TrendUp) {
                if (c.low <= m1S40[i] * 1.0002) {
                    setup = true; resistance = c.high;
                } else if (setup && c.close > resistance) {
                    let currentStake = balance;
                    let tp = currentStake * TP_PCT;
                    let sl = currentStake * SL_PCT;
                    let outcome = -sl;

                    for (let j = i + 1; j < allM1Candles.length; j++) {
                        const prof = ((allM1Candles[j].high - allM1Candles[i + 1].open) / allM1Candles[i + 1].open) * MULTIPLIER * currentStake;
                        const loss = ((allM1Candles[j].low - allM1Candles[i + 1].open) / allM1Candles[i + 1].open) * MULTIPLIER * currentStake;
                        if (prof >= tp) { outcome = tp; break; }
                        if (loss <= -sl) { outcome = -sl; break; }
                    }
                    balance += outcome;
                    if (outcome > 0) dayWins++; else dayLosses++;
                    if (balance > maxBalance) maxBalance = balance;
                    setup = false;
                }
            } else setup = false;
        }
        if (dayWins + dayLosses > 0) {
            console.log(`📅 ${date}: Balance $${balance.toFixed(2).padEnd(10)} | Ops: ${dayWins + dayLosses} (W:${dayWins} L:${dayLosses})`);
        }
    });

    console.log(`\n--------------------------------------------------`);
    console.log(`🏆 RESULTADO FINAL REAL (30 DÍAS):`);
    console.log(`Saldo inicial: $10.00`);
    console.log(`Saldo final real: $${balance.toFixed(2)}`);
    console.log(`Punto más alto alcanzado: $${maxBalance.toFixed(2)}`);
    console.log(`Multiplicador Real: ${(balance / 10).toFixed(1)}x`);
    console.log(`--------------------------------------------------\n`);
}
