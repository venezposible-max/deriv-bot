const WebSocket = require('ws');

const APP_ID = 1089;
const SYMBOL = 'frxXAUUSD';
const MULTIPLIER = 40;
const TP_PCT = 0.10; // 10% de ganancia por trade
const SL_PCT = 0.20; // 20% de pérdida por trade

const endTS = Math.floor(Date.now() / 1000);
const startTS = endTS - (7 * 24 * 60 * 60);

console.log(`\n🔥 BACKTEST SEMANAL AGRESIVO: ORO (TODO AL BALANCE)`);
console.log(`==========================================================`);
console.log(`Estrategia: PM-40 OK + Filtro H1`);
console.log(`Gestión: Reinvestir 100% del Saldo en cada trade`);
console.log(`==========================================================\n`);

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

let m1Candles = [];
let h1Candles = [];
let balance = 10.00;

ws.on('open', () => {
    ws.send(JSON.stringify({ ticks_history: SYMBOL, end: 'latest', start: startTS, count: 10000, granularity: 60, style: 'candles' }));
    ws.send(JSON.stringify({ ticks_history: SYMBOL, end: 'latest', start: startTS, count: 200, granularity: 3600, style: 'candles' }));
});

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.msg_type === 'candles') {
        if (msg.echo_req.granularity === 60) m1Candles = msg.candles || [];
        if (msg.echo_req.granularity === 3600) h1Candles = msg.candles || [];
        if (m1Candles.length > 0 && h1Candles.length > 0) {
            runAggressiveBacktest();
            ws.close();
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
    const m1Closes = m1Candles.map(c => c.close);
    const m1S20 = calculateSMA(m1Closes, 20);
    const m1S40 = calculateSMA(m1Closes, 40);
    const h1Closes = h1Candles.map(c => c.close);
    const h1S20 = calculateSMA(h1Closes, 20);
    const h1S40 = calculateSMA(h1Closes, 40);

    let dayMap = {};
    m1Candles.forEach((c, i) => {
        const date = new Date(c.epoch * 1000).toISOString().split('T')[0];
        if (!dayMap[date]) dayMap[date] = [];
        dayMap[date].push({ candle: c, index: i });
    });

    Object.keys(dayMap).sort().forEach(date => {
        let dayWins = 0, dayLosses = 0;
        let setup = false, resistance = 0;

        for (const event of dayMap[date]) {
            const i = event.index;
            const c = event.candle;
            if (balance < 1) break;

            const currentH1 = h1Candles.findLast(h => h.epoch <= c.epoch);
            const h1Idx = h1Candles.indexOf(currentH1);
            let h1TrendUp = h1Idx >= 40 ? h1S20[h1Idx] > h1S40[h1Idx] : true;

            if (m1S20[i] > m1S40[i] && h1TrendUp) {
                if (c.low <= m1S40[i] * 1.0002) {
                    setup = true; resistance = c.high;
                } else if (setup && c.close > resistance) {
                    let currentStake = balance;
                    let tp = currentStake * TP_PCT;
                    let sl = currentStake * SL_PCT;
                    let outcome = -sl;

                    for (let j = i + 1; j < m1Candles.length; j++) {
                        const prof = ((m1Candles[j].high - m1Candles[i + 1].open) / m1Candles[i + 1].open) * MULTIPLIER * currentStake;
                        const loss = ((m1Candles[j].low - m1Candles[i + 1].open) / m1Candles[i + 1].open) * MULTIPLIER * currentStake;
                        if (prof >= tp) { outcome = tp; break; }
                        if (loss <= -sl) { outcome = -sl; break; }
                    }
                    balance += outcome;
                    if (outcome > 0) dayWins++; else dayLosses++;
                    setup = false;
                } else if (setup && c.close < m1S40[i]) setup = false;
            } else setup = false;
        }
        console.log(`📅 ${date}: Balance Final: $${balance.toFixed(2)} | W: ${dayWins} L: ${dayLosses}`);
    });

    console.log(`\n--------------------------------------------------`);
    console.log(`🏆 RESULTADO FINAL AGRESIVO (7 DÍAS):`);
    console.log(`Saldo de $10.00 se convirtió en: $${balance.toFixed(2)}`);
    console.log(`Multiplicador Total: ${(balance / 10).toFixed(1)}x`);
    console.log(`--------------------------------------------------\n`);
}
