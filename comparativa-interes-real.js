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

console.log(`\n⚔️ COMPARATIVA REAL 30 DÍAS: AGRESIVO VS COMPUESTO PRO`);
console.log(`==========================================================`);
console.log(`Símbolo: Oro (XAUUSD) | Inversión Inicial: $10.00`);
console.log(`Cargando datos históricos...`);

ws.on('open', () => {
    // Pedir H1
    ws.send(JSON.stringify({
        ticks_history: SYMBOL, end: 'latest', start: startTS, granularity: 3600, style: 'candles'
    }));
    // Pedir M1 en el primer bloque
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
            if (earliest && earliest > startTS && received.length === 5000) {
                requestM1(earliest - 1);
            } else {
                console.log(`✅ Datos cargados: ${allM1Candles.length} velas M1 logradas.`);
                runComparison();
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

function runComparison() {
    allM1Candles.sort((a, b) => a.epoch - b.epoch);
    allH1Candles.sort((a, b) => a.epoch - b.epoch);

    const m1Closes = allM1Candles.map(c => c.close);
    const m1S20 = calculateSMA(m1Closes, 20);
    const m1S40 = calculateSMA(m1Closes, 40);
    const h1Closes = allH1Candles.map(c => c.close);
    const h1S20 = calculateSMA(h1Closes, 20);
    const h1S40 = calculateSMA(h1Closes, 40);

    let balAggressive = 10.00;
    let balConservative = 10.00;

    let dayMap = {};
    allM1Candles.forEach((c, i) => {
        const date = new Date(c.epoch * 1000).toISOString().split('T')[0];
        if (!dayMap[date]) dayMap[date] = [];
        dayMap[date].push({ candle: c, index: i });
    });

    Object.keys(dayMap).sort().forEach(date => {
        const events = dayMap[date];
        for (let idx = 0; idx < events.length; idx++) {
            const event = events[idx];
            const i = event.index;
            const c = event.candle;

            if (balAggressive < 1 && balConservative < 1) break;

            // Filtro H1
            const h1C = allH1Candles.findLast(h => h.epoch <= c.epoch);
            const h1Idx = allH1Candles.indexOf(h1C);
            let h1TrendUp = h1Idx >= 40 ? h1S20[h1Idx] > h1S40[h1Idx] : true;

            if (m1S20[i] > m1S40[i] && h1TrendUp) {
                if (c.low <= m1S40[i] * 1.0002) {
                    let resistance = c.high;

                    for (let k = i + 1; k < i + 20 && k < allM1Candles.length; k++) {
                        if (allM1Candles[k].close > resistance) {
                            if (balAggressive >= 1) {
                                let outcomeA = executeSimTrade(k, balAggressive, 1.0);
                                balAggressive += outcomeA;
                            }

                            if (balConservative >= 1) {
                                let outcomeB = executeSimTrade(k, balConservative, 0.1);
                                balConservative += outcomeB;
                            }

                            // Saltar el índice para evitar múltiples trades en la misma zona
                            // Buscamos el evento que corresponde al índice k + 10
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
    });

    function executeSimTrade(startIdx, currentBalance, riskPct) {
        if (currentBalance < 1) return 0;
        let stake = currentBalance * riskPct;
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

    console.log(`\n📊 RESULTADOS FINALES TRAS 30 DÍAS DE DATOS REALES:`);
    console.log(`--------------------------------------------------`);
    console.log(`🚀 MODO AGRESIVO (100% Stake): $${balAggressive.toFixed(2)}`);
    console.log(`🛡️ MODO COMPUESTO PRO (10% Stake): $${balConservative.toFixed(2)}`);
    console.log(`--------------------------------------------------`);
    console.log(`Diferencia: $${(balAggressive - balConservative).toFixed(2)}`);
    console.log(`==================================================\n`);
}
