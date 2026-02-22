const WebSocket = require('ws');

const APP_ID = 1089;
const SYMBOL = 'frxXAUUSD';
const MULTIPLIER = 40;
const STAKE = 10;
const TP = 1.00;
const SL = 2.00;
const DAILY_DRAWDOWN_LIMIT = 0.50; // $0.50 por cada $10 (5%)

const endTS = Math.floor(Date.now() / 1000);
const startTS = endTS - (7 * 24 * 60 * 60); // 7 días

console.log(`\n💎 BACKTEST SEMANAL PRO: ORO (PM-40 OK + FILTRO H1)`);
console.log(`==========================================================`);
console.log(`Periodo: Últimos 7 días | Riesgo: 5% Diario`);
console.log(`==========================================================\n`);

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

let m1Candles = [];
let h1Candles = [];

ws.on('open', () => {
    // Pedir M1
    ws.send(JSON.stringify({
        ticks_history: SYMBOL,
        end: 'latest',
        start: startTS,
        count: 10000,
        granularity: 60,
        style: 'candles'
    }));
    // Pedir H1
    ws.send(JSON.stringify({
        ticks_history: SYMBOL,
        end: 'latest',
        start: startTS,
        count: 200,
        granularity: 3600,
        style: 'candles'
    }));
});

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.msg_type === 'candles') {
        const candles = msg.candles || [];
        if (msg.echo_req.granularity === 60) m1Candles = candles;
        if (msg.echo_req.granularity === 3600) h1Candles = candles;

        if (m1Candles.length > 0 && h1Candles.length > 0) {
            runProBacktest();
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

function runProBacktest() {
    const m1Closes = m1Candles.map(c => c.close);
    const m1S20 = calculateSMA(m1Closes, 20);
    const m1S40 = calculateSMA(m1Closes, 40);

    const h1Closes = h1Candles.map(c => c.close);
    const h1S20 = calculateSMA(h1Closes, 20);
    const h1S40 = calculateSMA(h1Closes, 40);

    let totalPnL = 0;
    let totalWins = 0;
    let totalLosses = 0;
    let daysAnalyzed = 0;

    // Agrupar por días
    let dayMap = {};
    m1Candles.forEach((c, i) => {
        const date = new Date(c.epoch * 1000).toISOString().split('T')[0];
        if (!dayMap[date]) dayMap[date] = [];
        dayMap[date].push({ candle: c, index: i });
    });

    Object.keys(dayMap).sort().forEach(date => {
        daysAnalyzed++;
        let dayPnL = 0;
        let dayWins = 0;
        let dayLosses = 0;
        let setup = false;
        let resistance = 0;
        let isDrawdownLocked = false;

        const dayEvents = dayMap[date];

        for (const event of dayEvents) {
            const i = event.index;
            const c = event.candle;

            // Filtro de Drawdown Diario
            if (dayPnL <= -DAILY_DRAWDOWN_LIMIT) {
                isDrawdownLocked = true;
            }

            if (isDrawdownLocked) continue;

            // Encontrar tendencia H1 correspondiente
            const currentH1 = h1Candles.findLast(h => h.epoch <= c.epoch);
            const h1Idx = h1Candles.indexOf(currentH1);
            let h1TrendUp = false;
            if (h1Idx >= 40) {
                h1TrendUp = h1S20[h1Idx] > h1S40[h1Idx];
            }

            // Lógica PM-40 (Solo si H1 es alcista)
            if (m1S20[i] > m1S40[i] && h1TrendUp) {
                if (c.low <= m1S40[i] * 1.0002) {
                    setup = true;
                    resistance = c.high;
                    continue;
                }

                if (setup && c.close > resistance) {
                    // DISPARO
                    let outcome = -SL;
                    for (let j = i + 1; j < m1Candles.length; j++) {
                        const targetHigh = ((m1Candles[j].high - m1Candles[i + 1].open) / m1Candles[i + 1].open) * MULTIPLIER * STAKE;
                        const targetLow = ((m1Candles[j].low - m1Candles[i + 1].open) / m1Candles[i + 1].open) * MULTIPLIER * STAKE;
                        if (targetHigh >= TP) { outcome = TP; break; }
                        if (targetLow <= -SL) { outcome = -SL; break; }
                    }

                    dayPnL += outcome;
                    if (outcome > 0) dayWins++; else dayLosses++;
                    setup = false;
                    // Cooldown de 10 velas tras trade
                    // (Simulado saltando iteraciones)
                } else if (setup) {
                    if (c.high < resistance) resistance = c.high;
                    if (c.close < m1S40[i] * 0.998) setup = false;
                }
            } else {
                setup = false;
            }
        }

        totalPnL += dayPnL;
        totalWins += dayWins;
        totalLosses += dayLosses;

        console.log(`📅 ${date}: PnL $${dayPnL.toFixed(2)} | W: ${dayWins} L: ${dayLosses} ${dayPnL <= -DAILY_DRAWDOWN_LIMIT ? '🔴 (DRAWDOWN)' : '✅'}`);
    });

    console.log(`\n--------------------------------------------------`);
    console.log(`🏆 RESULTADO FINAL SEMANAL:`);
    console.log(`PnL Total: $${totalPnL.toFixed(2)}`);
    console.log(`Operaciones: ${totalWins + totalLosses}`);
    console.log(`Victorias: ${totalWins} | Derrotas: ${totalLosses}`);
    console.log(`Win Rate: ${((totalWins / (totalWins + totalLosses)) * 100).toFixed(1)}%`);
    console.log(`Profit Factory: ${(Math.abs(totalWins * TP) / Math.abs(totalLosses * SL)).toFixed(2)}`);
    console.log(`--------------------------------------------------\n`);
}
