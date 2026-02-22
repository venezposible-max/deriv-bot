const fs = require('fs');
const WebSocket = require('ws');

// CONFIG
const APP_ID = 1089;
const SYMBOL = 'frxXAUUSD';
const startTS = Math.floor(new Date('2026-02-19T00:00:00Z').getTime() / 1000);
const endTS = Math.floor(new Date('2026-02-19T23:59:59Z').getTime() / 1000);

let allTicks = [];
let nextEndTime = endTS;

console.log(`🔍 Iniciando Optimizador de ORO (XAU/USD)...`);

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

ws.on('open', () => fetchBatch());

function fetchBatch() {
    ws.send(JSON.stringify({
        ticks_history: SYMBOL,
        end: nextEndTime,
        start: startTS,
        count: 5000,
        style: 'ticks'
    }));
}

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.msg_type === 'history') {
        const prices = msg.history.prices;
        const times = msg.history.times;
        if (prices.length > 0) {
            allTicks = prices.concat(allTicks);
            nextEndTime = times[0] - 1;
            if (nextEndTime > startTS && allTicks.length < 100000) fetchBatch();
            else { runOptimization(allTicks); ws.close(); }
        } else { runOptimization(allTicks); ws.close(); }
    }
});

function runOptimization(ticks) {
    console.log(`\n✅ Datos cargados: ${ticks.length} ticks. Buscando configuraciones ganadoras...`);

    const momentumSettings = [5, 7, 10, 12, 15, 20];
    const takeProfitSettings = [0.30, 0.50, 1.00, 2.00];
    const stopLossSettings = [3.00, 5.00];
    const stake = 10;
    const multiplier = 40;

    let results = [];

    momentumSettings.forEach(m => {
        takeProfitSettings.forEach(tp => {
            stopLossSettings.forEach(sl => {
                const res = simulate(m, tp, sl, stake, multiplier, ticks);
                if (res.totalTrades > 5) {
                    results.push(res);
                }
            });
        });
    });

    // Ordenar por PnL Total
    results.sort((a, b) => b.pnl - a.pnl);

    console.log(`\n🏆 TOP 5 CONFIGURACIONES PARA ORO:`);
    results.slice(0, 5).forEach((r, i) => {
        console.log(`${i + 1}. M:${r.momentum} | TP:${r.tp.toFixed(2)} | SL:${r.sl.toFixed(2)} -> PnL: $${r.pnl.toFixed(2)} (WR: ${r.wr.toFixed(1)}% | Trades: ${r.totalTrades})`);
    });
}

function simulate(m, tp, sl, stake, mult, ticks) {
    let balance = 0, wins = 0, losses = 0, totalTrades = 0, inTrade = false, entryPrice = 0, tradeType = null;
    for (let i = m; i < ticks.length; i++) {
        const currentPrice = ticks[i];
        if (!inTrade) {
            const lastTicks = ticks.slice(i - m, i);
            const allDown = lastTicks.every((v, idx) => idx === 0 || v < lastTicks[idx - 1]);
            const allUp = lastTicks.every((v, idx) => idx === 0 || v > lastTicks[idx - 1]);
            if (allDown) { inTrade = true; tradeType = 'UP'; entryPrice = currentPrice; }
            else if (allUp) { inTrade = true; tradeType = 'DOWN'; entryPrice = currentPrice; }
        } else {
            let diffPct = (currentPrice - entryPrice) / entryPrice;
            if (tradeType === 'DOWN') diffPct = -diffPct;
            const profit = diffPct * mult * stake;
            if (profit >= tp) { wins++; totalTrades++; balance += tp; inTrade = false; i += 30; }
            else if (profit <= -sl) { losses++; totalTrades++; balance -= sl; inTrade = false; i += 30; }
        }
    }
    return { momentum: m, tp: tp, sl: sl, pnl: balance, wr: (wins / totalTrades) * 100 || 0, totalTrades: totalTrades };
}
