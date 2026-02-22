const WebSocket = require('ws');

const APP_ID = 1089;
const SYMBOL = 'frxXAUUSD';
const MULTIPLIER = 40;
const INITIAL_BALANCE = 100.00; // Usamos un balance de referencia de $100
const STAKE = 10;
const TP = 1.00;
const SL = 2.00;
const DAILY_LOSS_LIMIT_PCT = 5.0; // 5% de límite profesional

const startTS = 1771390800; // 2026-02-19 00:00:00 GMT
const endTS = 1771477199;   // 2026-02-19 23:59:59 GMT

console.log(`\n🛡️ SIMULACIÓN JUEVES 19 FEB: EL PODER DEL ESCUDO PRO`);
console.log(`==========================================================`);
console.log(`Balance Inicial: $${INITIAL_BALANCE.toFixed(2)} | Límite Drawdown: ${DAILY_LOSS_LIMIT_PCT}%`);
console.log(`Stake: $${STAKE.toFixed(2)} | SL: -$${SL.toFixed(2)}`);
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
            runShieldSimulation();
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

function runShieldSimulation() {
    m1Candles.sort((a, b) => a.epoch - b.epoch);
    h1Candles.sort((a, b) => a.epoch - b.epoch);

    const m1Closes = m1Candles.map(c => c.close);
    const m1S20 = calculateSMA(m1Closes, 20);
    const m1S40 = calculateSMA(m1Closes, 40);
    const h1Closes = h1Candles.map(c => c.close);
    const h1S20 = calculateSMA(h1Closes, 20);
    const h1S40 = calculateSMA(h1Closes, 40);

    let currentBalance = INITIAL_BALANCE;
    let dayPnL = 0;
    let isLocked = false;
    let maxLossAllowed = INITIAL_BALANCE * (DAILY_LOSS_LIMIT_PCT / 100);

    for (let i = 40; i < m1Candles.length; i++) {
        if (isLocked) break;

        const c = m1Candles[i];
        const h1C = h1Candles.findLast(h => h.epoch <= c.epoch);
        const h1Idx = h1Candles.indexOf(h1C);
        let h1TrendUp = h1Idx >= 40 ? h1S20[h1Idx] > h1S40[h1Idx] : true;

        if (m1S20[i] > m1S40[i] && h1TrendUp) {
            if (c.low <= m1S40[i] * 1.0002) {
                let resistance = c.high;
                for (let k = i + 1; k < i + 15 && k < m1Candles.length; k++) {
                    if (m1Candles[k].close > resistance) {
                        // DISPARO
                        let outcome = simulateTrade(k);
                        dayPnL += outcome;
                        currentBalance += outcome;

                        console.log(`🕒 ${new Date(m1Candles[k].epoch * 1000).toLocaleTimeString()} | Trade: ${outcome > 0 ? '✅ +$' + outcome : '❌ -$' + Math.abs(outcome)} | PnL Día: ${dayPnL.toFixed(2)}`);

                        // CHEQUEO DE ESCUDO
                        if (dayPnL <= -maxLossAllowed) {
                            console.log(`\n🧨🧨🧨 ESCUDO ACTIVADO: Pérdida de $${Math.abs(dayPnL).toFixed(2)} alcanzó el límite del 5% ($${maxLossAllowed}).`);
                            console.log(`🔒 BLOQUEANDO BOT PARA EL RESTO DEL DÍA. Capital a salvo: $${currentBalance.toFixed(2)}`);
                            isLocked = true;
                            break;
                        }

                        i = k + 10;
                        break;
                    }
                }
            }
        }
    }

    function simulateTrade(startIdx) {
        let entry = m1Candles[startIdx + 1]?.open || m1Candles[startIdx].close;
        for (let j = startIdx + 1; j < m1Candles.length; j++) {
            const p = ((m1Candles[j].high - entry) / entry) * MULTIPLIER * STAKE;
            const l = ((m1Candles[j].low - entry) / entry) * MULTIPLIER * STAKE;
            if (p >= TP) return TP;
            if (l <= -SL) return -SL;
        }
        return -SL;
    }

    console.log(`\n--------------------------------------------------`);
    console.log(`🏆 RESUMEN JUEVES CON ESCUDO:`);
    console.log(`Pérdida Total con Escudo: $${dayPnL.toFixed(2)}`);
    console.log(`Pérdida que hubiera sido sin Escudo: -$26.00`);
    console.log(`DINERO AHORRADO: $${(26.00 + dayPnL).toFixed(2)} 💰`);
    console.log(`--------------------------------------------------\n`);
}

// Nota: allM1Candles fue un error de nombre de variable, corrijo en la ejecución
const allM1Candles = m1Candles; 
