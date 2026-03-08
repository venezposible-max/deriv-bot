const WebSocket = require('ws');

// CONFIGURACIÓN PARA TESTEAR SI EL PROBLEMA ES EL SL CORTO
const SYMBOL = 'stpRNG';
const CONFIG_A = { stake: 20, takeProfit: 3.0, stopLoss: 1.5, multiplier: 750, momentum: 5, distLimit: 0.08 }; // Actual
const CONFIG_B = { stake: 20, takeProfit: 4.0, stopLoss: 3.0, multiplier: 750, momentum: 5, distLimit: 0.12 }; // Más aire

console.log(`\n🕵️‍♂️ COMPARANDO ESTRATEGIAS (ÚLTIMA HORA EN VIVO)...`);

const ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=1089');

ws.on('open', () => {
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

        function simulate(config) {
            let pnl = 0, wins = 0, losses = 0, active = null;
            for (let i = 200; i < prices.length; i++) {
                if (active) {
                    const diff = active.type === 'CALL' ? (prices[i] - active.entry) : (active.entry - prices[i]);
                    const prof = diff * 10;
                    if (prof >= config.takeProfit) { pnl += config.takeProfit; wins++; active = null; }
                    else if (prof <= -config.stopLoss) { pnl -= config.stopLoss; losses++; active = null; }
                    continue;
                }
                const lastTicks = prices.slice(i - 200, i);
                const sma50 = lastTicks.slice(-50).reduce((a, b) => a + b, 0) / 50;
                const sma200 = lastTicks.reduce((a, b) => a + b, 0) / 200;
                const dist = Math.abs(prices[i] - sma50) / prices[i] * 100;
                const momUp = prices.slice(i - 5, i).every((p, idx, arr) => idx === 0 || p > arr[idx - 1]);
                const momDown = prices.slice(i - 5, i).every((p, idx, arr) => idx === 0 || p < arr[idx - 1]);

                if (dist <= config.distLimit) {
                    if (momUp && prices[i] > sma50 && sma50 > sma200) active = { type: 'CALL', entry: prices[i] };
                    else if (momDown && prices[i] < sma50 && sma50 < sma200) active = { type: 'PUT', entry: prices[i] };
                }
            }
            return { pnl, wins, losses };
        }

        const resA = simulate(CONFIG_A);
        const resB = simulate(CONFIG_B);

        console.log(`\n📊 CONFIG A (Actual - SL $1.5):`);
        console.log(`PnL: $${resA.pnl.toFixed(2)} | W: ${resA.wins} | L: ${resA.losses}`);

        console.log(`\n📊 CONFIG B (Más aire - SL $3.0 | Dist 0.12):`);
        console.log(`PnL: $${resB.pnl.toFixed(2)} | W: ${resB.wins} | L: ${resB.losses}`);

        ws.close();
    }
});
