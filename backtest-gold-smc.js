const WebSocket = require('ws');
const APP_ID = 1089;
const SYMBOL = 'frxXAUUSD';

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
let allTicks = [];
const TOTAL_TICKS_NEEDED = 20000;

const CONFIG = {
    stake: 20,
    takeProfit: 5.00,
    stopLoss: 8.00,
    multiplier: 500,
    latency: 1
};

ws.on('open', () => {
    console.log(`\n📥 EJECUTANDO ESTRATEGIA "SMC - ORDER BLOCK" EN ORO (XAUUSD)...`);
    console.log(`🧠 Lógica: Detección de Bloques de Órdenes + Re-entrada de Mitigación.`);
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
            console.log(`\n✅ DATA CARGADA (${allTicks.length} ticks).`);
            runSMCOrderBlockBacktest();
            ws.close();
        }
    }
});

function runSMCOrderBlockBacktest() {
    let balance = 0, wins = 0, losses = 0, trades = 0;
    let inTrade = false, entryPrice = 0, tradeType = null;

    // Lista de bloques de órdenes detectados
    let orderBlocks = [];

    // Una vela simulada (M1) es de 60 ticks aprox
    const CANDLE_TICKS = 60;

    for (let i = CANDLE_TICKS * 10; i < allTicks.length - 100; i++) {
        const quote = allTicks[i];

        // 1. DETECCIÓN DE BLOQUES DE ÓRDENES (ORDER BLOCKS)
        // Detectamos una vela de "expansión" fuerte que indica presencia institucional
        if (i % CANDLE_TICKS === 0) {
            const currentCandleOpen = allTicks[i - CANDLE_TICKS];
            const currentCandleClose = allTicks[i];
            const candleBody = Math.abs(currentCandleClose - currentCandleOpen);

            // Si el cuerpo de la vela es muy grande (Explosión)
            if (candleBody > 0.15) { // Umbral de expansión para Oro
                orderBlocks.push({
                    type: currentCandleClose > currentCandleOpen ? 'BULLISH' : 'BEARISH',
                    high: Math.max(currentCandleOpen, currentCandleClose),
                    low: Math.min(currentCandleOpen, currentCandleClose),
                    timestamp: i,
                    mitigated: false
                });
                // Mantener solo los últimos 5 bloques
                if (orderBlocks.length > 5) orderBlocks.shift();
            }
        }

        // 2. LÓGICA DE ENTRADA (MITIGACIÓN)
        if (!inTrade) {
            for (let ob of orderBlocks) {
                if (!ob.mitigated) {
                    // Si el precio regresa a la zona del bloque de órdenes (Mitigación)
                    if (ob.type === 'BULLISH' && quote <= ob.high && quote >= ob.low) {
                        inTrade = true;
                        tradeType = 'UP';
                        entryPrice = quote;
                        ob.mitigated = true;
                        trades++;
                        break;
                    } else if (ob.type === 'BEARISH' && quote >= ob.low && quote <= ob.high) {
                        inTrade = true;
                        tradeType = 'DOWN';
                        entryPrice = quote;
                        ob.mitigated = true;
                        trades++;
                        break;
                    }
                }
            }
        } else {
            // GESTIÓN DEL TRADE
            let priceChangePct = (quote - entryPrice) / entryPrice;
            if (tradeType === 'DOWN') priceChangePct = -priceChangePct;
            const profit = priceChangePct * CONFIG.multiplier * CONFIG.stake;

            if (profit >= CONFIG.takeProfit) {
                balance += CONFIG.takeProfit;
                wins++;
                inTrade = false;
                i += 200; // Salimos de la zona
            } else if (profit <= -CONFIG.stopLoss) {
                balance -= CONFIG.stopLoss;
                losses++;
                inTrade = false;
                i += 200;
            }
        }
    }

    console.log("\n=========================================");
    console.log("💎 ESTRATEGIA: SMC - ORDER BLOCKS (GOLD)");
    console.log("=========================================");
    console.log(`PnL Neto ($): ${balance.toFixed(2)}`);
    console.log(`Win Rate: ${((wins / (trades || 1)) * 100).toFixed(1)}%`);
    console.log(`Ganadas: ${wins} | Perdidas: ${losses}`);
    console.log(`Total Trades: ${trades}`);
    console.log("=========================================\n");
}
