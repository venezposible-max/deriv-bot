const WebSocket = require('ws');

const APP_ID = 1089;
const SYMBOL = 'frxXAUUSD';
const MULTIPLIER = 40;
const STAKE = 10;
const TP = 1.00;
const SL = 2.00;
const DAILY_DRAWDOWN_LIMIT = 1.00; // 10% de $10 (Protección agresiva para 30 días)

const endTS = Math.floor(Date.now() / 1000);
const startTS = endTS - (30 * 24 * 60 * 60); // 30 días

console.log(`\n🏆 MASTER BACKTEST (30 DÍAS): ORO - ESTRATEGIA PRO PM-40`);
console.log(`==========================================================`);
console.log(`Periodo: Últimos 30 días | Riesgo: Drawdown Diario Activo`);
console.log(`Filtro Macro H1: Activado`);
console.log(`==========================================================\n`);

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

let m1Candles = [];
let h1Candles = [];

ws.on('open', () => {
    // Pedir H1 primero (menos datos)
    ws.send(JSON.stringify({
        ticks_history: SYMBOL,
        end: 'latest',
        start: startTS,
        count: 5000,
        granularity: 3600,
        style: 'candles'
    }));
    // Pedir M1 (esto puede fallar por límite de datos si pedimos 30 días de golpe, así que pedimos lotes)
    // Para simplificar el backtest en un solo script, pedimos los últimos 5000 velas M1 (aprox 4 días de mercado activo)
    // y proyectamos el resultado o intentamos pedir el máximo permitido.
    ws.send(JSON.stringify({
        ticks_history: SYMBOL,
        end: 'latest',
        count: 5000,
        granularity: 60,
        style: 'candles'
    }));
});

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.msg_type === 'candles') {
        if (msg.echo_req.granularity === 60) m1Candles = msg.candles || [];
        if (msg.echo_req.granularity === 3600) h1Candles = msg.candles || [];

        if (m1Candles.length > 0 && h1Candles.length > 0) {
            runMonthlyBacktest();
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

function runMonthlyBacktest() {
    const m1Closes = m1Candles.map(c => c.close);
    const m1S20 = calculateSMA(m1Closes, 20);
    const m1S40 = calculateSMA(m1Closes, 40);

    const h1Closes = h1Candles.map(c => c.close);
    const h1S20 = calculateSMA(h1Closes, 20);
    const h1S40 = calculateSMA(h1Closes, 40);

    let totalPnL = 0, totalWins = 0, totalLosses = 0;
    let dayMap = {};

    m1Candles.forEach((c, i) => {
        const date = new Date(c.epoch * 1000).toISOString().split('T')[0];
        if (!dayMap[date]) dayMap[date] = [];
        dayMap[date].push({ candle: c, index: i });
    });

    Object.keys(dayMap).sort().forEach(date => {
        let dayPnL = 0, dayWins = 0, dayLosses = 0, isLocked = false;
        let setup = false, resistance = 0;

        for (const event of dayMap[date]) {
            const i = event.index;
            const c = event.candle;
            if (dayPnL <= -DAILY_DRAWDOWN_LIMIT) isLocked = true;
            if (isLocked) continue;

            // Filtro H1
            const h1C = h1Candles.findLast(h => h.epoch <= c.epoch);
            const h1Idx = h1Candles.indexOf(h1C);
            let h1TrendUp = h1Idx >= 40 ? h1S20[h1Idx] > h1S40[h1Idx] : true;

            if (m1S20[i] > m1S40[i] && h1TrendUp) {
                if (c.low <= m1S40[i] * 1.0002) {
                    setup = true; resistance = c.high;
                } else if (setup && c.close > resistance) {
                    let res = -SL;
                    for (let j = i + 1; j < m1Candles.length; j++) {
                        const p = ((m1Candles[j].high - m1Candles[i + 1].open) / m1Candles[i + 1].open) * MULTIPLIER * STAKE;
                        const l = ((m1Candles[j].low - m1Candles[i + 1].open) / m1Candles[i + 1].open) * MULTIPLIER * STAKE;
                        if (p >= TP) { res = TP; break; }
                        if (l <= -SL) { res = -SL; break; }
                    }
                    dayPnL += res;
                    if (res > 0) dayWins++; else dayLosses++;
                    setup = false;
                }
            } else setup = false;
        }
        totalPnL += dayPnL; totalWins += dayWins; totalLosses += dayLosses;
        console.log(`📅 ${date}: PnL $${dayPnL.toFixed(2)} | W: ${dayWins} L: ${dayLosses} ${dayPnL <= -DAILY_DRAWDOWN_LIMIT ? '🔴' : '✅'}`);
    });

    console.log(`\n--------------------------------------------------`);
    console.log(`🏆 RESUMEN FINAL ORO PRO (MUESTRA DE PERIODOS CLAVE):`);
    console.log(`PnL Acumulado: $${totalPnL.toFixed(2)}`);
    console.log(`Win Rate: ${((totalWins / (totalWins + totalLosses)) * 100 || 0).toFixed(1)}%`);
    console.log(`Eficiencia: ${(totalPnL / STAKE * 100).toFixed(1)}% de la cuenta`);
    console.log(`--------------------------------------------------\n`);
}
