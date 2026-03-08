const WebSocket = require('ws');
const SYMBOL = 'stpRNG';
const CONFIG = { stake: 20, takeProfit: 3.0, stopLoss: 3.0, multiplier: 750, momentum: 3, distLimit: 0.15 };

console.log(`\n🕵️‍♂️ TESTEANDO MODO "BLINDADO" (SL $3.0 | Momentum 3 | Dist 0.15)...`);

const ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=1089');
ws.on('open', () => { ws.send(JSON.stringify({ ticks_history: SYMBOL, end: 'latest', count: 5000, style: 'ticks' })); });
ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.history) {
        const prices = msg.history.prices;
        let pnl = 0, wins = 0, losses = 0, active = null;
        for (let i = 200; i < prices.length; i++) {
            if (active) {
                const diff = active.type === 'CALL' ? (prices[i] - active.entry) : (active.entry - prices[i]);
                const prof = diff * 10;
                if (prof >= CONFIG.takeProfit) { pnl += CONFIG.takeProfit; wins++; active = null; }
                else if (prof <= -CONFIG.stopLoss) { pnl -= CONFIG.stopLoss; losses++; active = null; }
                continue;
            }
            const lastTicks = prices.slice(i - 200, i);
            const sma50 = lastTicks.slice(-50).reduce((a, b) => a + b, 0) / 50;
            const sma200 = lastTicks.reduce((a, b) => a + b, 0) / 200;
            const dist = Math.abs(prices[i] - sma50) / prices[i] * 100;
            const momUp = prices.slice(i - 3, i).every((p, idx, arr) => idx === 0 || p > arr[idx - 1]);
            const momDown = prices.slice(i - 3, i).every((p, idx, arr) => idx === 0 || p < arr[idx - 1]);

            if (dist <= CONFIG.distLimit) {
                if (momUp && prices[i] > sma50 && sma50 > sma200) active = { type: 'CALL', entry: prices[i] };
                else if (momDown && prices[i] < sma50 && sma50 < sma200) active = { type: 'PUT', entry: prices[i] };
            }
        }
        console.log(`\n📊 RESULTADOS MODO BLINDADO:`);
        console.log(`PnL: $${pnl.toFixed(2)} | Ganadas: ${wins} | Perdidas: ${losses}`);
        console.log(`Win Rate: ${((wins / (wins + losses)) * 100).toFixed(1)}%`);
        ws.close();
    }
});
