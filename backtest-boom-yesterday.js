const WebSocket = require('ws');
const APP_ID = 1089;
const SYMBOL = 'BOOM1000';

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
let allTicks = [];
// Para un día entero (ayer) necesitamos aprox 15,000 - 20,000 ticks
const TOTAL_TICKS_NEEDED = 20000;

const CONFIG = {
    stake: 20,
    timeStopTicks: 15, // Cierre rápido si no hay spike
};

ws.on('open', () => {
    console.log(`\n📥 EJECUTANDO BACKTEST: BOOM 1000 (Datos de Ayer)...`);
    console.log(`🧠 Estrategia: Sniper CCI-RSI + Time-Stop.`);
    fetchTicks();
});

function fetchTicks(beforeEpoch = 'latest') {
    ws.send(JSON.stringify({
        ticks_history: SYMBOL,
        end: beforeEpoch || 'latest',
        count: 5000,
        style: 'ticks'
    }));
}

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.msg_type === 'history') {
        const chunk = msg.history.prices || [];
        const times = msg.history.times || [];
        allTicks = [...chunk, ...allTicks];

        if (allTicks.length < TOTAL_TICKS_NEEDED && chunk.length > 0) {
            process.stdout.write('.');
            fetchTicks(times[0]);
        } else {
            console.log(`\n✅ DATA DE AYER CARGADA (${allTicks.length} ticks). Procesando simulación...`);
            runYesterdaySniperBacktest();
            ws.close();
        }
    }
});

function calculateSMA(p, n) { if (p.length < n) return null; return p.slice(-n).reduce((a, b) => a + b, 0) / n; }

function calculateRSI(prices, period) {
    if (prices.length < period + 1) return 50;
    let gains = 0, losses = 0;
    for (let i = prices.length - period; i < prices.length; i++) {
        let diff = prices[i] - prices[i - 1];
        if (diff >= 0) gains += diff; else losses -= diff;
    }
    let rs = (gains / period) / (losses / period || 1);
    return 100 - (100 / (1 + rs));
}

function calculateCCI(prices, period) {
    if (prices.length < period) return 0;
    const sma = calculateSMA(prices, period);
    let meanDev = 0;
    for (let i = prices.length - period; i < prices.length; i++) meanDev += Math.abs(prices[i] - sma);
    meanDev = meanDev / period;
    if (meanDev === 0) return 0;
    return (prices[prices.length - 1] - sma) / (0.015 * meanDev);
}

function runYesterdaySniperBacktest() {
    let balance = 0, wins = 0, losses = 0, trades = 0;
    let inTrade = false, entryPrice = 0, ticksInTrade = 0;
    let drawdownMax = 0;
    let balanceHistory = [];

    for (let i = 200; i < allTicks.length - 20; i++) {
        const quote = allTicks[i];

        if (!inTrade) {
            const rsi = calculateRSI(allTicks.slice(i - 100, i), 14);
            const cci = calculateCCI(allTicks.slice(i - 14, i), 14);
            const sma50 = calculateSMA(allTicks.slice(i - 50, i), 50);

            if (!sma50) continue;
            const distSMA = Math.abs(quote - sma50) / sma50 * 100;

            // REGLAS SNIPER
            if (rsi < 25 && cci > -150 && distSMA < 0.12) {
                inTrade = true;
                entryPrice = quote;
                ticksInTrade = 0;
                trades++;
            }
        } else {
            ticksInTrade++;
            const move = quote - entryPrice;

            // Detección de Spike
            if (move > 0.6) {
                const profit = move * 10; // Factor de ganancia
                balance += profit;
                wins++;
                inTrade = false;
                i += 40;
            }
            else if (ticksInTrade >= CONFIG.timeStopTicks) {
                balance -= 1.0;
                losses++;
                inTrade = false;
                i += 10;
            }
        }

        if (balance < drawdownMax) drawdownMax = balance;
        balanceHistory.push(balance);
    }

    console.log("\n=========================================");
    console.log("📊 RESULTADO BOOM 1000 - SOLO AYER");
    console.log("=========================================");
    console.log(`PnL Neto ($): ${balance.toFixed(2)}`);
    console.log(`Win Rate: ${((wins / (trades || 1)) * 100).toFixed(1)}%`);
    console.log(`Spikes Capturados: ${wins}`);
    console.log(`Fallos (Time-Stop): ${losses}`);
    console.log(`Racha Máxima Negativa (Drawdown): $${Math.abs(drawdownMax).toFixed(2)}`);
    console.log("-----------------------------------------");
    console.log(`Si empezabas con $85, terminarías con: $${(85 + balance).toFixed(2)}`);
    console.log("=========================================\n");
}
