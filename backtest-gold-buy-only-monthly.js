const WebSocket = require('ws');

// CONFIGURACIÓN BACKTEST ORO (XAUUSD) - ESTRATEGIA "W" PATTERN (ONLY BUY) - ÚLTIMO MES
const APP_ID = 1089;
const SYMBOL = 'frxXAUUSD'; // Oro
const STAKE = 10;
const MULTIPLIER = 200;
const GRANULARITY = 300; // 5 minutos (M5)

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

ws.on('open', () => {
    console.log("📊 Iniciando Backtest ORO INSTITUTIONAL (Solo Compras - W Pattern) - ÚLTIMO MES...");
    ws.send(JSON.stringify({
        ticks_history: SYMBOL,
        end: 'latest',
        count: 5000,
        style: 'candles',
        granularity: GRANULARITY
    }));
});

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.msg_type === 'candles') {
        runBacktest(msg.candles);
        ws.close();
    }
});

function runBacktest(candles) {
    let wins = 0;
    let losses = 0;
    let totalPnL = 0;
    let activeTrade = null;
    let history = [];

    const totalCandles = candles.length;
    const startIndex = 50;

    for (let i = startIndex; i < totalCandles; i++) {
        const currentCandle = candles[i];
        const currentPrice = currentCandle.open;

        if (!activeTrade) {
            // --- DETECCIÓN DE PATRÓN "W" (SOLO COMPRA) ---
            let pivotsL = [], pivotsH = [];
            for (let j = i - 1; j > i - 40; j--) {
                const prev = candles[j - 1], cur = candles[j], next = candles[j + 1];
                if (!prev || !next) continue;
                if (cur.low < prev.low && cur.low < next.low) pivotsL.push({ price: cur.low, index: j });
                if (cur.high > prev.high && cur.high > next.high) pivotsH.push({ price: cur.high, index: j });
            }

            if (pivotsL.length >= 2 && pivotsH.length >= 1) {
                const l2 = pivotsL[0].price, l1 = pivotsL[1].price, hh = pivotsH[0].price;
                // CONDICIÓN W: Higher Low + Ruptura de HH
                if (l2 > l1 && currentPrice > hh && pivotsL[0].index > pivotsH[0].index && pivotsH[0].index > pivotsL[1].index) {
                    const slPrice = l2;
                    const distPct = Math.abs(currentPrice - slPrice) / currentPrice;
                    let slAmount = STAKE * MULTIPLIER * (distPct + 0.0001);
                    if (slAmount >= STAKE) slAmount = STAKE * 0.95;
                    const tpAmount = slAmount * 2;

                    activeTrade = {
                        type: 'UP (W)', entry: currentPrice, slDist: currentPrice - slPrice,
                        slAmt: slAmount, tpAmt: tpAmount,
                        time: new Date(currentCandle.epoch * 1000).toLocaleString('es-VE')
                    };
                }
            }
        } else {
            let profit = 0;
            // Solo evaluamos el cierre para trades UP
            if (currentCandle.low <= (activeTrade.entry - activeTrade.slDist)) profit = -activeTrade.slAmt;
            else if (currentCandle.high >= (activeTrade.entry + (activeTrade.slDist * 2))) profit = activeTrade.tpAmt;

            if (profit !== 0) {
                if (profit > 0) wins++; else losses++;
                totalPnL += profit;
                history.push({ ...activeTrade, profit });
                activeTrade = null;
            }
        }
    }

    console.log("\n========================================");
    console.log("🥇 REPORTE MENSUAL ORO 'SOLO COMPRAS' (W)");
    console.log("========================================");
    console.log(`Stake: $${STAKE} | Estrategia: Solo Alzas`);
    console.log(`Periodo: Últimos 30 días aprox.`);
    console.log(`Total Trades: ${history.length}`);
    console.log(`Ganados 🟢: ${wins} | Perdidos 🔴: ${losses}`);
    console.log("----------------------------------------");
    console.log(`PnL NETO ACUMULADO: $${totalPnL.toFixed(2)} USD`);
    console.log(`Retorno Total: ${((totalPnL / STAKE) * 100).toFixed(1)}%`);
    console.log(`Promedio Semanal: $${(totalPnL / 4).toFixed(2)} USD`);
    console.log(`Eficiencia: ${((wins / history.length) * 100).toFixed(1)}%`);
    console.log("========================================\n");
}
