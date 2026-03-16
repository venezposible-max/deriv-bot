const WebSocket = require('ws');

// CONFIGURACIÓN BACKTEST ORO (XAUUSD) - ESTRATEGIA "W/M" PATTERN (GIB)
const APP_ID = 1089;
const SYMBOL = 'frxXAUUSD'; // Oro
const STAKE = 10;
const MULTIPLIER = 200;
const GRANULARITY = 300; // 5 minutos (M5)

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

ws.on('open', () => {
    console.log("📊 Iniciando Backtest ORO INSTITUTIONAL (W/M Pattern) - ÚLTIMA SEMANA...");
    ws.send(JSON.stringify({
        ticks_history: SYMBOL,
        end: 'latest',
        count: 2000,
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
    // Aproximadamente 5 días hábiles de oro
    const startIndex = Math.max(50, totalCandles - 1440);

    for (let i = 50; i < totalCandles; i++) {
        const currentCandle = candles[i];
        const currentPrice = currentCandle.open;
        const isWithinRange = i >= startIndex;

        if (!activeTrade && isWithinRange) {
            // --- DETECCIÓN DE PATRÓN "W" (COMPRA) ---
            let hh = 0, l1 = 0, l2 = 0;
            let pivotsL = [];
            let pivotsH = [];

            // Buscar pivotes en las últimas 40 velas
            for (let j = i - 1; j > i - 40; j--) {
                const prev = candles[j - 1], cur = candles[j], next = candles[j + 1];
                if (!prev || !next) continue;

                // Pivot Low
                if (cur.low < prev.low && cur.low < next.low) pivotsL.push({ price: cur.low, index: j });
                // Pivot High
                if (cur.high > prev.high && cur.high > next.high) pivotsH.push({ price: cur.high, index: j });
            }

            // Lógica "W": Necesitamos dos mínimos donde el segundo sea mayor
            if (pivotsL.length >= 2 && pivotsH.length >= 1) {
                l2 = pivotsL[0].price; // Mínimo más reciente
                l1 = pivotsL[1].price; // Mínimo anterior
                hh = pivotsH[0].price; // El "techo" de la W

                // CONDICIÓN W: Mínimo 2 > Mínimo 1 (Higher Low) Y precio rompiendo HH
                if (l2 > l1 && currentPrice > hh && pivotsL[0].index > pivotsH[0].index && pivotsH[0].index > pivotsL[1].index) {
                    const slPrice = l2; // SL en el Higher Low
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

            // --- DETECCIÓN DE PATRÓN "M" (VENTA) ---
            if (!activeTrade && pivotsH.length >= 2 && pivotsL.length >= 1) {
                const h2 = pivotsH[0].price; // Máximo más reciente (Lower High)
                const h1 = pivotsH[1].price; // Máximo anterior
                const ll = pivotsL[0].price; // El "suelo" de la M

                // CONDICIÓN M: Máximo 2 < Máximo 1 (Lower High) Y precio rompiendo LL
                if (h2 < h1 && currentPrice < ll && pivotsH[0].index > pivotsL[0].index && pivotsL[0].index > pivotsH[1].index) {
                    const slPrice = h2; // SL en el Lower High
                    const distPct = Math.abs(currentPrice - slPrice) / currentPrice;
                    let slAmount = STAKE * MULTIPLIER * (distPct + 0.0001);
                    if (slAmount >= STAKE) slAmount = STAKE * 0.95;
                    const tpAmount = slAmount * 2;

                    activeTrade = {
                        type: 'DOWN (M)', entry: currentPrice, slDist: slPrice - currentPrice,
                        slAmt: slAmount, tpAmt: tpAmount,
                        time: new Date(currentCandle.epoch * 1000).toLocaleString('es-VE')
                    };
                }
            }
        } else if (activeTrade) {
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
                history.push({ ...activeTrade, profit, time: activeTrade.time });
                activeTrade = null;
            }
        }
    }

    console.log("\n========================================");
    console.log("🥇 RESULTADO ORO ESTRATEGIA 'W / M'");
    console.log("========================================");
    console.log(`Periodo: Última Semana (M5)`);
    console.log(`Patrón: W (Higher Low) / M (Lower High)`);
    console.log(`Total Trades: ${history.length}`);
    console.log(`Ganados 🟢: ${wins} | Perdidos 🔴: ${losses}`);
    console.log("----------------------------------------");
    console.log(`PnL NETO: $${totalPnL.toFixed(2)} USD`);
    console.log(`Retorno: ${((totalPnL / STAKE) * 100).toFixed(1)}%`);
    console.log(`Profit Factor: ${(wins > 0 ? (totalPnL > 0 ? (totalPnL / STAKE + 1) : 0) : 0).toFixed(2)}`);
    console.log("========================================\n");

    if (history.length > 0) {
        console.log("Últimos movimientos detectados:");
        history.slice(-10).forEach((h, idx) => {
            console.log(`${idx + 1}. [${h.type}] PnL: ${h.profit > 0 ? '🟢' : '🔴'} $${h.profit.toFixed(2)} (${h.time})`);
        });
    }
}
