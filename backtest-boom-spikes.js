const WebSocket = require('ws');
const APP_ID = 1089;
const SYMBOL = 'BOOM1000'; // El rey de los picos alcistas

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
let allTicks = [];
const TOTAL_TICKS_NEEDED = 20000;

const CONFIG = {
    stake: 20,
    takeProfit: 5.00,
    stopLoss: 3.00,
    multiplier: 1, // En Boom/Crash el multiplicador es diferente, simulamos por movimiento
};

ws.on('open', () => {
    console.log(`\n📥 EJECUTANDO ESTRATEGIA "SPIKE HUNTER" EN BOOM 1000...`);
    console.log(`🧠 Lógica: Detección de Agotamiento (RSI < 15) + Micro-Reacción Alcista.`);
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
            console.log(`\n✅ DATA CARGADA (${allTicks.length} ticks). Buscando Spikes...`);
            runSpikeHunterBacktest();
            ws.close();
        }
    }
});

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

function runSpikeHunterBacktest() {
    let balance = 0, wins = 0, losses = 0, trades = 0;
    let inTrade = false, entryPrice = 0;

    for (let i = 100; i < allTicks.length - 20; i++) {
        const quote = allTicks[i];

        if (!inTrade) {
            const rsi = calculateRSI(allTicks.slice(i - 50, i), 14);

            // ESTRATEGIA BOOM: Comprar cuando el precio está muy agotado (RSI muy bajo)
            // Esperamos que el RSI baje de 15, lo que indica que el Spike está por venir
            if (rsi < 15) {
                inTrade = true;
                entryPrice = quote;
                trades++;
            }
        } else {
            // Un "Spike" en Boom 1000 suele ser de más de 1.0 punto
            const move = quote - entryPrice;

            // Si hay un spike violento (ganancia rápida)
            if (move > 0.8) {
                const profit = move * (CONFIG.stake / 2); // Simulación de ganancia por lote
                balance += profit;
                wins++;
                inTrade = false;
                i += 50; // Esperar a que pase la euforia del spike
            }
            // Si el precio sigue bajando contra nosotros (SL de tiempo/ticks)
            else if (move < -1.5) {
                balance -= (Math.abs(move) * (CONFIG.stake / 2));
                losses++;
                inTrade = false;
            }
        }
    }

    console.log("\n=========================================");
    console.log("💥 RESULTADO ESTRATEGIA: SPIKE HUNTER (BOOM)");
    console.log("=========================================");
    console.log(`PnL Neto ($): ${balance.toFixed(2)}`);
    console.log(`Win Rate: ${((wins / (trades || 1)) * 100).toFixed(1)}%`);
    console.log(`Spikes Capturados: ${wins}`);
    console.log(`Intentos Fallidos: ${losses}`);
    console.log(`Total Intentos: ${trades}`);
    console.log("=========================================\n");
}
