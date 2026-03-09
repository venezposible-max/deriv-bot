const WebSocket = require('ws');
const APP_ID = 1089;
const SYMBOL = 'BOOM1000';

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
let allTicks = [];
const TOTAL_TICKS_NEEDED = 30000;

const CONFIG = {
    stake: 20,
    takeProfit: 5.00,
    stopLoss: 3.00,
    multiplier: 1,
};

ws.on('open', () => {
    console.log(`\n📥 EJECUTANDO ESTRATEGIA "CCI-RSI SNIPER 2026" EN BOOM 1000...`);
    console.log(`🧠 Lógica: RSI(14) en Zona Extreme (<30) + CCI(14) Rejection + Momentum AO.`);
    fetchTicks();
});

function fetchTicks(beforeEpoch = 'latest') {
    ws.send(JSON.stringify({ ticks_history: SYMBOL, end: beforeEpoch || 'latest', count: 5000, style: 'ticks' }));
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
            console.log(`\n✅ DATA CARGADA (${allTicks.length} ticks). Procesando Algoritmo Sniper...`);
            runCCISniperBacktest();
            ws.close();
        }
    }
});

// --- INDICADORES ---
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

function runCCISniperBacktest() {
    let balance = 0, wins = 0, losses = 0, trades = 0;
    let inTrade = false, entryPrice = 0, ticksInTrade = 0;

    for (let i = 200; i < allTicks.length - 100; i++) {
        const quote = allTicks[i];

        if (!inTrade) {
            const rsi = calculateRSI(allTicks.slice(i - 100, i), 14);
            const cci = calculateCCI(allTicks.slice(i - 14, i), 14);
            const sma50 = calculateSMA(allTicks.slice(i - 50, i), 50);

            // SNIPER ENTRY RULES:
            // 1. RSI en zona de acumulación (Agotamiento bajista)
            // 2. CCI saliendo de la zona de pánico (Rechazo)
            // 3. El precio está cerca de la media de 50 (Soporte dinámico)
            const distSMA = Math.abs(quote - sma50) / sma50 * 100;

            if (rsi < 25 && cci > -150 && distSMA < 0.10) {
                inTrade = true;
                entryPrice = quote;
                ticksInTrade = 0;
                trades++;
            }
        } else {
            ticksInTrade++;
            const move = quote - entryPrice;

            // Si ocurre el Spike (Ganancia explosiva)
            if (move > 0.6) {
                const profit = move * (CONFIG.stake / 2);
                balance += profit;
                wins++;
                inTrade = false;
                i += 60; // Cooldown tras el spike
            }
            // Salimos por tiempo (Si el spike no llega en 15 ticks, cerramos para proteger)
            // Esta es la clave del sniper: no esperar la muerte
            else if (ticksInTrade > 15) {
                balance -= 1.0; // Pérdida controlada mínima
                losses++;
                inTrade = false;
                i += 30;
            }
        }
    }

    console.log("\n=========================================");
    console.log("🕵️‍♂️ RESULTADO: CCI-RSI SNIPER (BOOM 1000)");
    console.log("=========================================");
    console.log(`PnL Neto ($): ${balance.toFixed(2)}`);
    console.log(`Win Rate: ${((wins / (trades || 1)) * 100).toFixed(1)}%`);
    console.log(`Spikes Capturados: ${wins}`);
    console.log(`Trades Fallidos: ${losses}`);
    console.log(`Total Intentos: ${trades}`);
    console.log("=========================================\n");
}
