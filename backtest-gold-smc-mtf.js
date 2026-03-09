const WebSocket = require('ws');
const APP_ID = 1089;
const SYMBOL = 'frxXAUUSD';

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
let allTicks = [];
const TOTAL_TICKS_NEEDED = 30000; // Necesitamos mucha data para ver bloques en M15/H1

ws.on('open', () => {
    console.log(`\n📥 EJECUTANDO ESTRATEGIA "SMC MULTI-TIME-FRAME" EN ORO (XAUUSD)...`);
    console.log(`🧠 Lógica: bloques en H1/M15 -> Confirmación CHoCH en M1 -> Entrada en Ticks.`);
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
            runSMCMTFBacktest();
            ws.close();
        }
    }
});

function createCandles(prices, granularity) {
    let candles = [];
    for (let i = 0; i < prices.length; i += granularity) {
        let chunk = prices.slice(i, i + granularity);
        if (chunk.length < granularity) break;
        candles.push({
            open: chunk[0],
            close: chunk[chunk.length - 1],
            high: Math.max(...chunk),
            low: Math.min(...chunk)
        });
    }
    return candles;
}

function runSMCMTFBacktest() {
    let balance = 0, wins = 0, losses = 0, trades = 0;
    let inTrade = false, entryPrice = 0, tradeType = null, stopLoss = 0, takeProfit = 0;

    // Configuramos los bloques en M15 (aprox 900 ticks)
    const M15_TICKS = 900;
    const M1_TICKS = 60;

    for (let i = M15_TICKS * 10; i < allTicks.length - 500; i++) {
        const quote = allTicks[i];

        if (!inTrade) {
            // --- PASO 1: DETECCIÓN DE BLOQUES EN HIGHT TIMEFRAME (M15) ---
            const m15Candles = createCandles(allTicks.slice(i - (M15_TICKS * 10), i), M15_TICKS);
            if (m15Candles.length < 5) continue;

            let htfOrderBlock = null;
            const lastM15 = m15Candles[m15Candles.length - 1];
            const prevM15 = m15Candles[m15Candles.length - 2];

            // Un bloque es alcista si la vela anterior fue bajista y la actual rompe su máximo
            if (lastM15.close > prevM15.high) {
                htfOrderBlock = { type: 'BULLISH', low: prevM15.low, high: prevM15.high };
            } else if (lastM15.close < prevM15.low) {
                htfOrderBlock = { type: 'BEARISH', low: prevM15.low, high: prevM15.high };
            }

            if (!htfOrderBlock) continue;

            // --- PASO 2: WAIT FOR PRICE TO HIT HTF OB (Mitigación) ---
            let mitigationReached = false;
            if (htfOrderBlock.type === 'BULLISH' && quote <= htfOrderBlock.high && quote >= htfOrderBlock.low) mitigationReached = true;
            if (htfOrderBlock.type === 'BEARISH' && quote >= htfOrderBlock.low && quote <= htfOrderBlock.high) mitigationReached = true;

            if (mitigationReached) {
                // --- PASO 3: CONFIRMACIÓN EN LOW TIMEFRAME (M1) - CHoCH ---
                const m1Candles = createCandles(allTicks.slice(i - (M1_TICKS * 10), i), M1_TICKS);
                const lastM1 = m1Candles[m1Candles.length - 1];
                const prevM1 = m1Candles[m1Candles.length - 2];

                let chochConfirmed = false;
                if (htfOrderBlock.type === 'BULLISH' && lastM1.close > prevM1.high) chochConfirmed = true;
                if (htfOrderBlock.type === 'BEARISH' && lastM1.close < prevM1.low) chochConfirmed = true;

                if (chochConfirmed) {
                    inTrade = true;
                    tradeType = htfOrderBlock.type === 'BULLISH' ? 'UP' : 'DOWN';
                    entryPrice = quote;

                    // Gestión SMC: SL al borde del bloque HTF, TP al siguiente swing
                    const risk = Math.abs(entryPrice - htfOrderBlock.low);
                    if (tradeType === 'UP') {
                        stopLoss = htfOrderBlock.low - 0.05;
                        takeProfit = entryPrice + (risk * 2.5); // RR 1:2.5
                    } else {
                        stopLoss = htfOrderBlock.high + 0.05;
                        takeProfit = entryPrice - (risk * 2.5);
                    }
                    trades++;
                }
            }
        } else {
            // MONITOR DE TRADE
            if (tradeType === 'UP') {
                if (quote >= takeProfit) {
                    balance += (takeProfit - entryPrice) * 1000; // Simulamos beneficio por pips
                    wins++; inTrade = false; i += M15_TICKS;
                } else if (quote <= stopLoss) {
                    balance -= Math.abs(entryPrice - stopLoss) * 1000;
                    losses++; inTrade = false; i += M15_TICKS;
                }
            } else {
                if (quote <= takeProfit) {
                    balance += (entryPrice - takeProfit) * 1000;
                    wins++; inTrade = false; i += M15_TICKS;
                } else if (quote >= stopLoss) {
                    balance -= Math.abs(stopLoss - entryPrice) * 1000;
                    losses++; inTrade = false; i += M15_TICKS;
                }
            }
            // Tiempo límite de trade (1 hora = 4 velas M15)
            if (inTrade && i % (M15_TICKS * 4) === 0) {
                inTrade = false; // Cerramos por tiempo
            }
        }
    }

    console.log("\n=========================================");
    console.log("🕵️‍♂️ ESTRATEGIA: SMC MTF (M15 -> M1) - ORO");
    console.log("=========================================");
    console.log(`Puntos Netos: ${balance.toFixed(2)}`);
    console.log(`Win Rate: ${((wins / (trades || 1)) * 100).toFixed(1)}%`);
    console.log(`Ganadas: ${wins} | Perdidas: ${losses}`);
    console.log(`Total Trades: ${trades}`);
    console.log("=========================================\n");
}
