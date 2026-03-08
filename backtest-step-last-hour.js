const WebSocket = require('ws');

// CONFIGURACIÓN OPTIMIZADA (IGUAL A LA DEL SERVER)
const SYMBOL = 'stpRNG';
const SNIPER_CONFIG = {
    stake: 20,
    takeProfit: 3.00,
    stopLoss: 1.50,
    multiplier: 750,
    smaPeriod: 50,
    smaLongPeriod: 200,
    rsiPeriod: 14,
    momentum: 5,
    distLimit: 0.08
};

console.log(`\n🕵️‍♂️ ANALIZANDO ÚLTIMA HORA EN STEP INDEX (stpRNG)...`);

const ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=1089');

ws.on('open', () => {
    // Pedimos exactamente 3600 ticks (aprox 1 hora si es 1 tick/seg, pero Step Index es más rápido)
    // Para asegurar 1 hora real, pediremos 5000 ticks.
    ws.send(JSON.stringify({
        ticks_history: SYMBOL,
        end: 'latest',
        count: 5000,
        style: 'ticks'
    }));
});

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.history) {
        const prices = msg.history.prices;
        console.log(`✅ DATA RECUPERADA: ${prices.length} ticks.`);

        // --- SIMULACIÓN ---
        let pnl = 0;
        let wins = 0;
        let losses = 0;
        let activeTrade = null;

        for (let i = 200; i < prices.length; i++) {
            if (activeTrade) {
                const currentPrice = prices[i];
                const diff = activeTrade.type === 'CALL' ? (currentPrice - activeTrade.entry) : (activeTrade.entry - currentPrice);

                // Estimación de PnL para Step Index (basado en el comportamiento observado)
                // En Step Index con Mult 750, un movimiento de 0.1 suele ser ~10% del stake.
                // Usamos la lógica de los backtests anteriores.
                const currentProfit = diff * 10;

                if (currentProfit >= SNIPER_CONFIG.takeProfit) {
                    pnl += currentProfit;
                    wins++;
                    activeTrade = null;
                } else if (currentProfit <= -SNIPER_CONFIG.stopLoss) {
                    pnl += currentProfit;
                    losses++;
                    activeTrade = null;
                }
                continue;
            }

            // Lógica Sniper Elite
            const lastTicks = prices.slice(i - 200, i);
            const sma50 = lastTicks.slice(-50).reduce((a, b) => a + b, 0) / 50;
            const sma200 = lastTicks.reduce((a, b) => a + b, 0) / 200;
            const currentPrice = prices[i];

            // Distancia a la SMA
            const dist = Math.abs(currentPrice - sma50) / currentPrice * 100;

            // Momentum (5 ticks seguidos)
            const momUp = prices.slice(i - 5, i).every((p, idx, arr) => idx === 0 || p > arr[idx - 1]);
            const momDown = prices.slice(i - 5, i).every((p, idx, arr) => idx === 0 || p < arr[idx - 1]);

            if (dist <= SNIPER_CONFIG.distLimit) {
                if (momUp && currentPrice > sma50 && sma50 > sma200) {
                    activeTrade = { type: 'CALL', entry: currentPrice };
                } else if (momDown && currentPrice < sma50 && sma50 < sma200) {
                    activeTrade = { type: 'PUT', entry: currentPrice };
                }
            }
        }

        console.log(`\n=========================================`);
        console.log(`📊 RESULTADOS ÚLTIMA HORA (REAL)`);
        console.log(`=========================================`);
        console.log(`Total Trades: ${wins + losses}`);
        console.log(`Ganadas: ${wins} ✅ | Perdidas: ${losses} ❌`);
        console.log(`PnL Estimado: $${pnl.toFixed(2)} 💰`);
        console.log(`Win Rate: ${((wins / (wins + losses)) * 100).toFixed(1)}%`);
        console.log(`=========================================\n`);

        ws.close();
    }
});
