const WebSocket = require('ws');

const APP_ID = 1089;
const SYMBOL = 'frxXAUUSD';
const MULTIPLIER = 40;
const TP_PCT = 0.10;
const SL_PCT = 0.20;

const DAYS_TO_BACKTEST = 180; // 6 Meses
const endTS = Math.floor(Date.now() / 1000);
const startTS = endTS - (DAYS_TO_BACKTEST * 24 * 60 * 60);

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

let allM1Candles = [];
let allH1Candles = [];

console.log(`\n🔥 CORRIDA MAESTRA 6 MESES (ALL-IN): ORO`);
console.log(`==========================================================`);
console.log(`Estrategia: PM-40 Pro | Reinvirtiendo 100% en cada trade`);
console.log(`Cargando datos históricos (esto puede tardar unos segundos)...`);

ws.on('open', () => {
    // Pedir H1 de 6 meses
    ws.send(JSON.stringify({
        ticks_history: SYMBOL, end: 'latest', start: startTS, granularity: 3600, style: 'candles'
    }));
    // Pedir M1 en bloques
    requestM1(endTS);
});

function requestM1(beforeTS) {
    ws.send(JSON.stringify({
        ticks_history: SYMBOL, end: beforeTS, count: 5000, granularity: 60, style: 'candles'
    }));
}

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.msg_type === 'candles') {
        if (msg.echo_req.granularity === 3600) {
            allH1Candles = msg.candles || [];
        } else {
            const received = msg.candles || [];
            allM1Candles = received.concat(allM1Candles);
            const earliest = received[0]?.epoch;
            // Deriv a veces limita M1 a 20.000 o 30.000 velas atrás
            if (earliest && earliest > startTS && received.length === 5000 && allM1Candles.length < 50000) {
                requestM1(earliest - 1);
            } else {
                console.log(`✅ Datos cargados: ${allM1Candles.length} velas M1 encontradas (${Math.round(allM1Candles.length / 1440)} días de mercado real).`);
                run6MonthSimulation();
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

function run6MonthSimulation() {
    allM1Candles.sort((a, b) => a.epoch - b.epoch);
    allH1Candles.sort((a, b) => a.epoch - b.epoch);

    const m1Closes = allM1Candles.map(c => c.close);
    const m1S20 = calculateSMA(m1Closes, 20);
    const m1S40 = calculateSMA(m1Closes, 40);
    const h1Closes = allH1Candles.map(c => c.close);
    const h1S20 = calculateSMA(h1Closes, 20);
    const h1S40 = calculateSMA(h1Closes, 40);

    let balance = 10.00;
    let maxReached = 10.00;
    let wiped = false;

    let dayMap = {};
    allM1Candles.forEach((c, i) => {
        const date = new Date(c.epoch * 1000).toISOString().split('T')[0];
        if (!dayMap[date]) dayMap[date] = [];
        dayMap[date].push({ candle: c, index: i });
    });

    const dates = Object.keys(dayMap).sort();

    console.log(`\n📅 PROGRESIÓN MENSUAL ESTIMADA (Basada en datos reales cargados):`);
    console.log(`--------------------------------------------------`);

    // Procesamos todos los días disponibles
    dates.forEach((date, dayIdx) => {
        if (balance < 1) {
            if (!wiped) {
                console.log(`🚨 [${date}] CUENTA QUEMADA: El balance bajó de $1.00.`);
                wiped = true;
            }
            return;
        }

        const events = dayMap[date];
        for (let idx = 0; idx < events.length; idx++) {
            const i = events[idx].index;
            const c = events[idx].candle;

            const h1C = allH1Candles.findLast(h => h.epoch <= c.epoch);
            const h1Idx = allH1Candles.indexOf(h1C);
            let h1TrendUp = h1Idx >= 40 ? h1S20[h1Idx] > h1S40[h1Idx] : true;

            if (m1S20[i] > m1S40[i] && h1TrendUp) {
                if (c.low <= m1S40[i] * 1.0002) {
                    let resistance = c.high;
                    for (let k = i + 1; k < i + 20 && k < allM1Candles.length; k++) {
                        if (allM1Candles[k].close > resistance) {
                            // TRADE
                            let stake = balance;
                            let res = executeSimTrade(k, stake);
                            balance += res;
                            if (balance > maxReached) maxReached = balance;

                            // Saltar para evitar ruido
                            const skipTarget = k + 10;
                            while (idx < events.length - 1 && events[idx].index < skipTarget) {
                                idx++;
                            }
                            break;
                        }
                    }
                }
            }
        }

        // Mostrar resumen cada 5 días para no saturar la terminal
        if ((dayIdx + 1) % 5 === 0 || dayIdx === dates.length - 1) {
            console.log(`📆 Día ${dayIdx + 1} (${date}): Balance $${balance.toFixed(2)}`);
        }
    });

    function executeSimTrade(startIdx, stake) {
        let tp = stake * TP_PCT;
        let sl = stake * SL_PCT;
        let entry = allM1Candles[startIdx + 1]?.open || allM1Candles[startIdx].close;
        for (let j = startIdx + 1; j < allM1Candles.length; j++) {
            const p = ((allM1Candles[j].high - entry) / entry) * MULTIPLIER * stake;
            const l = ((allM1Candles[j].low - entry) / entry) * MULTIPLIER * stake;
            if (p >= tp) return tp;
            if (l <= -sl) return -sl;
        }
        return 0;
    }

    console.log(`\n--------------------------------------------------`);
    console.log(`🏆 RESUMEN FINAL (6 MESES ALL-IN):`);
    console.log(`Saldo inicial: $10.00`);
    console.log(`Saldo final: $${balance.toFixed(2)}`);
    console.log(`Máximo capital alcanzado en la historia: $${maxReached.toFixed(2)}`);
    console.log(`Estado: ${balance >= 1 ? '✅ SOBREVIVIENTE' : '💀 CUENTA QUEMADA'}`);
    console.log(`--------------------------------------------------\n`);
}
