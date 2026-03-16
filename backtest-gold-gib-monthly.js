const WebSocket = require('ws');

// CONFIGURACIÓN BACKTEST ORO (XAUUSD) - ESTRATEGIA "W/M" PATTERN (GIB) - ÚLTIMO MES
const APP_ID = 1089;
const SYMBOL = 'frxXAUUSD'; // Oro
const STAKE = 10;
const MULTIPLIER = 200;
const GRANULARITY = 300; // 5 minutos (M5)

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

ws.on('open', () => {
    console.log("📊 Iniciando Backtest ORO INSTITUTIONAL (W/M Pattern) - ÚLTIMO MES...");
    ws.send(JSON.stringify({
        ticks_history: SYMBOL,
        end: 'latest',
        count: 5000, // Velas M5 para cubrir aproximadamente un mes (Gold abre 5 días/semana)
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
    // Aproximadamente 20 días hábiles (4 semanas) -> 20 * 24 * 12 = 5760 velas (si hay data)
    const startIndex = 50;

    for (let i = startIndex; i < totalCandles; i++) {
        const currentCandle = candles[i];
        const currentPrice = currentCandle.open;

        if (!activeTrade) {
            // --- DETECCIÓN DE PATRÓN "W" (COMPRA) ---
            let pivotsL = [], pivotsH = [];
            for (let j = i - 1; j > i - 40; j--) {
                const prev = candles[j - 1], cur = candles[j], next = candles[j + 1];
                if (!prev || !next) continue;
                if (cur.low < prev.low && cur.low < next.low) pivotsL.push({ price: cur.low, index: j });
                if (cur.high > prev.high && cur.high > next.high) pivotsH.push({ price: cur.high, index: j });
            }

            if (pivotsL.length >= 2 && pivotsH.length >= 1) {
                const l2 = pivotsL[0].price, l1 = pivotsL[1].price, hh = pivotsH[0].price;
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

            if (!activeTrade && pivotsH.length >= 2 && pivotsL.length >= 1) {
                const h2 = pivotsH[0].price, h1 = pivotsH[1].price, ll = pivotsL[0].price;
                if (h2 < h1 && currentPrice < ll && pivotsH[0].index > pivotsL[0].index && pivotsL[0].index > pivotsH[1].index) {
                    const h_sl = h2;
                    const distPct = Math.abs(currentPrice - h_sl) / currentPrice;
                    let slAmount = STAKE * MULTIPLIER * (distPct + 0.0001);
                    if (slAmount >= STAKE) slAmount = STAKE * 0.95;
                    const tpAmount = slAmount * 2;

                    activeTrade = {
                        type: 'DOWN (M)', entry: currentPrice, slDist: h_sl - currentPrice,
                        slAmt: slAmount, tpAmt: tpAmount,
                        time: new Date(currentCandle.epoch * 1000).toLocaleString('es-VE')
                    };
                }
            }
        } else {
            let profit = 0;
            if (activeTrade.type.includes('UP')) {
                if (currentCandle.low <= (activeTrade.entry - activeTrade.slDist)) profit = -activeTrade.slAmt;
                else if (currentCandle.high >= (activeTrade.entry + (activeTrade.slDist * 2))) profit = activeTrade.tpAmt;
            } else {
                if (currentCandle.high >= (activeTrade.entry + activeTrade.slDist)) profit = -activeTrade.slAmt;
                else if (currentCandle.low <= (activeTrade.entry - (activeTrade.slDist * 2))) profit = activeTrade.tpAmt;
            }

            if (profit !== 0) {
                if (profit > 0) wins++; else losses++;
                totalPnL += profit;
                history.push({ ...activeTrade, profit });
                activeTrade = null;
            }
        }
    }

    console.log("\n========================================");
    console.log("🥇 REPORTE MENSUAL ORO 'W/M PATTERN'");
    console.log("========================================");
    console.log(`Stake: $${STAKE} | Multiplier: x${MULTIPLIER}`);
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
