const WebSocket = require('ws');
const APP_ID = 1089;
const SYMBOL = 'R_100';

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
let allTicks = [];
const TOTAL_TICKS_NEEDED = 84000; // ~24 Horas

ws.on('open', () => {
    console.log(`📥 Descargando DATA TICKS para probar ESTRATEGIA DE ESTRUCTURA (24H)...`);
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
            console.log(`\n✅ DATA OK: ${allTicks.length} ticks.`);
            runMinuteStructureSimulation();
            ws.close();
        }
    }
});

function calculateSMA(prices, period) {
    if (prices.length < period) return null;
    let sum = 0;
    for (let i = prices.length - period; i < prices.length; i++) sum += prices[i];
    return sum / period;
}

function calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) return 50;
    let gains = 0, losses = 0;
    for (let i = prices.length - period; i < prices.length; i++) {
        let diff = prices[i] - prices[i - 1];
        if (diff >= 0) gains += diff; else losses -= diff;
    }
    let rs = (gains / period) / ((losses / period) || 1);
    return 100 - (100 / (1 + rs));
}

async function runMinuteStructureSimulation() {
    console.log(`\n====================================================`);
    console.log(`🎯 SIMULANDO: ESTRATEGIA DE ESTRUCTURA Y ACCIÓN (M1)`);
    console.log(`====================================================`);

    // 1. Agrupar ticks en velas de 60 ticks (aprox 1 minuto)
    let candles = [];
    for (let i = 0; i < allTicks.length; i += 60) {
        const chunk = allTicks.slice(i, i + 60);
        if (chunk.length < 60) break;
        candles.push({
            open: chunk[0],
            high: Math.max(...chunk),
            low: Math.min(...chunk),
            close: chunk[chunk.length - 1],
            ticks: chunk
        });
    }

    console.log(`📊 Velas M1 generadas: ${candles.length}`);

    let balance = 0, wins = 0, losses = 0, trades = 0;
    const stake = 20, tp = 3.00, sl = 1.80, multiplier = 40;

    // Empezamos desde la vela 51 para tener SMA 50
    for (let i = 50; i < candles.length - 1; i++) {
        const currentCandle = candles[i];
        const prevCandle = candles[i - 1];
        const prevPrevCandle = candles[i - 2];

        // --- CÁLCULO DE INDICADORES EN M1 ---
        const closePrices = candles.slice(0, i + 1).map(c => c.close);
        const sma50 = calculateSMA(closePrices, 50);
        const sma200 = calculateSMA(closePrices, 200); // Necesitaríamos más data para sma200 real, simularemos tendencia local
        const rsi = calculateRSI(closePrices, 14);

        if (!sma50) continue;

        // --- EVALUACIÓN DE ESTRUCTURA (Price Action) ---
        // 1. Tendencia: ¿Estamos por encima de la media?
        const isBullishTrend = currentCandle.close > sma50;
        const isBearishTrend = currentCandle.close < sma50;

        // 2. Estructura: ¿Máximos y Mínimos más altos? (HH + HL)
        const isHH = currentCandle.high > prevCandle.high;
        const isHL = currentCandle.low > prevCandle.low;
        const isLL = currentCandle.low < prevCandle.low;
        const isLH = currentCandle.high < prevCandle.high;

        // 3. Acción del Precio: ¿Vela cierra con fuerza? (Cuerpo > 50% del rango)
        const bodySize = Math.abs(currentCandle.close - currentCandle.open);
        const totalSize = currentCandle.high - currentCandle.low;
        const strongCandle = bodySize > (totalSize * 0.5);

        // --- DECISIÓN CADA MINUTO ---
        let trigger = null;
        if (isBullishTrend && isHH && isHL && strongCandle && rsi > 30 && rsi < 70) {
            trigger = 'UP';
        } else if (isBearishTrend && isLL && isLH && strongCandle && rsi > 30 && rsi < 70) {
            trigger = 'DOWN';
        }

        if (trigger) {
            trades++;
            // El trade ocurre en el SIGUIENTE minuto (vela i+1)
            const nextTicks = candles[i + 1].ticks;
            let inMinuteProfit = false;
            let entryPrice = nextTicks[0];
            let maxP = 0;
            let resultPnl = -sl;

            for (let t = 0; t < nextTicks.length; t++) {
                let diff = (nextTicks[t] - entryPrice) / entryPrice;
                if (trigger === 'DOWN') diff = -diff;
                let prof = diff * multiplier * stake;
                if (prof > maxP) maxP = prof;

                if (prof >= tp) { resultPnl = tp; break; }
                if (prof <= -1.45) { resultPnl = -sl; break; }

                // Trailing simple para el backtest de estructura
                if (maxP > 0.50 && prof < (maxP - 0.55)) {
                    resultPnl = Math.max(-sl, maxP - 0.55);
                    break;
                }
                resultPnl = prof; // Al final del minuto si no cerró
            }

            balance += resultPnl;
            if (resultPnl > 0) wins++; else losses++;
        }
    }

    console.log(`----------------------------------------------------`);
    console.log(`RESULTADOS ESTRATEGIA DE ESTRUCTURA (M1):`);
    console.log(`- Total Trades (24H): ${trades}`);
    console.log(`- Ganados: ${wins} ✅ | Perdidos: ${losses} ❌`);
    console.log(`- Win Rate: ${((wins / (trades || 1)) * 100).toFixed(1)}%`);
    console.log(`- PnL Neto 24H: $${balance.toFixed(2)} 💰`);
    console.log(`- Promedio: ${(trades / 1440).toFixed(2)} trades/min`);
    console.log(`----------------------------------------------------`);
    console.log(`CONCLUSIÓN:`);
    if (balance > 50) {
        console.log(`🚀 Esta estrategia es SÓLIDA. Filtra el ruido y busca calidad.`);
    } else {
        console.log(`⚠️ Es muy lenta o poco rentable comparada con el Sniper Elite.`);
    }
    console.log(`====================================================`);
}
