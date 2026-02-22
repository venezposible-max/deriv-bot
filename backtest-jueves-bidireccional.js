const WebSocket = require('ws');

const APP_ID = 1089;
const SYMBOL = 'frxXAUUSD';
const MULTIPLIER = 40;
const STAKE = 10;
const TP = 1.00;
const SL = 2.00;

// Jueves pasado (19 de Febrero de 2026)
const startTS = 1771390800; // 2026-02-19 00:00:00 GMT
const endTS = 1771477199;   // 2026-02-19 23:59:59 GMT

console.log(`\n⚔️ BACKTEST PRO BIDIRECCIONAL (CALL/PUT): ORO - JUEVES 19 FEB`);
console.log(`==========================================================`);
console.log(`Estrategia: PM-40 Bidireccional | Stake Fijo: $10.00`);
console.log(`Modo: Detecta tendencia bajista y opera PUT`);
console.log(`==========================================================\n`);

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

let m1Candles = [];
let h1Candles = [];

ws.on('open', () => {
    ws.send(JSON.stringify({ ticks_history: SYMBOL, end: 'latest', count: 1000, granularity: 3600, style: 'candles' }));
    ws.send(JSON.stringify({ ticks_history: SYMBOL, end: endTS, start: startTS, granularity: 60, style: 'candles' }));
});

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.msg_type === 'candles') {
        if (msg.echo_req.granularity === 3600) h1Candles = msg.candles || [];
        else m1Candles = msg.candles || [];
        if (m1Candles.length > 0 && h1Candles.length > 0) {
            runBidirectionalBacktest();
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

function runBidirectionalBacktest() {
    m1Candles.sort((a, b) => a.epoch - b.epoch);
    h1Candles.sort((a, b) => a.epoch - b.epoch);

    const m1Closes = m1Candles.map(c => c.close);
    const m1S20 = calculateSMA(m1Closes, 20);
    const m1S40 = calculateSMA(m1Closes, 40);

    const h1Closes = h1Candles.map(c => c.close);
    const h1S20 = calculateSMA(h1Closes, 20);
    const h1S40 = calculateSMA(h1Closes, 40);

    let pnl = 0, wins = 0, losses = 0;

    for (let i = 40; i < m1Candles.length; i++) {
        const c = m1Candles[i];
        const h1C = h1Candles.findLast(h => h.epoch <= c.epoch);
        if (!h1C) continue;
        const h1Idx = h1Candles.indexOf(h1C);

        // --- LÓGICA CALL (Tendencia Alcista) ---
        let h1TrendUp = h1Idx >= 40 ? h1S20[h1Idx] > h1S40[h1Idx] : true;
        if (m1S20[i] > m1S40[i] && h1TrendUp) {
            if (c.low <= m1S40[i] * 1.0002) {
                let resistance = c.high;
                for (let k = i + 1; k < i + 15 && k < m1Candles.length; k++) {
                    if (m1Candles[k].close > resistance) {
                        let res = simulateTrade(k, 'CALL');
                        pnl += res; wins += (res > 0 ? 1 : 0); losses += (res < 0 ? 1 : 0);
                        console.log(`🕒 ${new Date(m1Candles[k].epoch * 1000).toLocaleTimeString()} | 📈 CALL ${res > 0 ? '✅' : '❌'} | PN: ${pnl.toFixed(2)}`);
                        i = k + 10; break;
                    }
                }
            }
        }

        // --- LÓGICA PUT (Tendencia Bajista) ---
        let h1TrendDown = h1Idx >= 40 ? h1S20[h1Idx] < h1S40[h1Idx] : true;
        if (m1S20[i] < m1S40[i] && h1TrendDown) {
            if (c.high >= m1S40[i] * 0.9998) {
                let support = c.low;
                for (let k = i + 1; k < i + 15 && k < m1Candles.length; k++) {
                    if (m1Candles[k].close < support) {
                        let res = simulateTrade(k, 'PUT');
                        pnl += res; wins += (res > 0 ? 1 : 0); losses += (res < 0 ? 1 : 0);
                        console.log(`🕒 ${new Date(m1Candles[k].epoch * 1000).toLocaleTimeString()} | 📉 PUT  ${res > 0 ? '✅' : '❌'} | PN: ${pnl.toFixed(2)}`);
                        i = k + 10; break;
                    }
                }
            }
        }
    }

    function simulateTrade(startIdx, type) {
        let entry = m1Candles[startIdx + 1]?.open || m1Candles[startIdx].close;
        for (let j = startIdx + 1; j < m1Candles.length; j++) {
            let prof, loss;
            if (type === 'CALL') {
                prof = ((m1Candles[j].high - entry) / entry) * MULTIPLIER * STAKE;
                loss = ((m1Candles[j].low - entry) / entry) * MULTIPLIER * STAKE;
            } else {
                prof = ((entry - m1Candles[j].low) / entry) * MULTIPLIER * STAKE;
                loss = ((entry - m1Candles[j].high) / entry) * MULTIPLIER * STAKE;
            }
            if (prof >= TP) return TP;
            if (loss <= -SL) return -SL;
        }
        return -SL;
    }

    console.log(`\n--------------------------------------------------`);
    console.log(`🏆 RESUMEN JUEVES 19 FEB (BIDIRECCIONAL):`);
    console.log(`PnL Total: $${pnl.toFixed(2)}`);
    console.log(`Trades: ${wins + losses} (Wins: ${wins} Losses: ${losses})`);
    console.log(`Win Rate: ${((wins / (wins + losses)) * 100 || 0).toFixed(1)}%`);
    console.log(`--------------------------------------------------\n`);
}
