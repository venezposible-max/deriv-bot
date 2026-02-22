const WebSocket = require('ws');

const APP_ID = 1089;
const SYMBOL = 'frxXAUUSD';

// ORO (GOLD) - USAMOS VIERNES 20 DE FEBRERO (Último día de mercado abierto)
const startTS = Math.floor(new Date('2026-02-20T00:00:00Z').getTime() / 1000);
const endTS = Math.floor(new Date('2026-02-20T21:00:00Z').getTime() / 1000); // Antes del cierre de mercado

// CONFIGURACIÓN PM-40 PARA ORO
const TIMEFRAME = 300; // Velas de 5 Minutos (M5) - Más estable para Oro
const SMA_20_PERIOD = 20;
const SMA_40_PERIOD = 40;

const STAKE = 10;
const MULTIPLIER = 40;
const TP = 1.0;
const SL = 2.0;

console.log(`\n🥇 BACKTEST PREMIUM: ESTRATEGIA PM-40 (ORO - XAU/USD)`);
console.log(`==========================================================`);
console.log(`Periodo: Viernes 20/Feb (Mercado Real Abierto)`);
console.log(`Gráfico: M5 (5 minutos) | Ratio: 1:2`);
console.log(`Lógica: PM20 > PM40 + Pulback a SMA40 + Ruptura de Máximo`);
console.log(`==========================================================\n`);

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

ws.on('open', () => {
    ws.send(JSON.stringify({
        ticks_history: SYMBOL,
        end: endTS,
        start: startTS,
        granularity: TIMEFRAME,
        style: 'candles'
    }));
});

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.msg_type === 'candles') {
        const candles = msg.candles;
        if (!candles || candles.length < SMA_40_PERIOD) {
            console.log("❌ Datos insuficientes para calcular medias móviles.");
            process.exit(1);
        }
        console.log(`📊 Datos cargados: ${candles.length} velas analizadas.`);
        runPM40Simulation(candles);
        ws.close();
    }
});

function calculateSMA(data, period) {
    let smas = new Array(data.length).fill(null);
    for (let i = period - 1; i < data.length; i++) {
        let sum = 0;
        for (let j = 0; j < period; j++) {
            sum += data[i - j].close;
        }
        smas[i] = sum / period;
    }
    return smas;
}

function runPM40Simulation(candles) {
    const sma20 = calculateSMA(candles, SMA_20_PERIOD);
    const sma40 = calculateSMA(candles, SMA_40_PERIOD);

    let balance = 0, wins = 0, losses = 0, total = 0;
    let trendlineActive = false;
    let highAfterTouch = 0;

    for (let i = SMA_40_PERIOD; i < candles.length - 1; i++) {
        const c = candles[i];
        const s20 = sma20[i];
        const s40 = sma40[i];

        // 1) PM-20 sobre PM-40
        if (s20 > s40) {
            // 2 y 3) Toque PM-40 (Zona de compra)
            if (c.low <= s40) {
                trendlineActive = true;
                highAfterTouch = c.high;
                continue;
            }

            // 4 y 5) Gatillo: Vela que rompe el máximo anterior
            if (trendlineActive) {
                if (c.close > highAfterTouch) {
                    total++;
                    const result = simulateTrade(candles, i + 1);
                    if (result > 0) wins++; else losses++;
                    balance += result;
                    trendlineActive = false;
                    i += 12; // Cooldown (1 hora aprox en M5)
                } else {
                    if (c.high < highAfterTouch) highAfterTouch = c.high;
                    // Si el precio se aleja demasiado por debajo de la SMA40, anulamos
                    if (c.close < s40 * 0.999) trendlineActive = false;
                }
            }
        } else {
            trendlineActive = false;
        }
    }

    const wr = (wins / total) * 100 || 0;
    console.log(`🏆 RESULTADOS PM-40 EN ORO:`);
    console.log(`--------------------------------------------------`);
    console.log(`Operaciones: ${total}`);
    console.log(`Victorias: ${wins} ✅`);
    console.log(`Derrotas: ${losses} ❌`);
    console.log(`Win Rate: ${wr.toFixed(1)}%`);
    console.log(`PnL Neto: $${balance.toFixed(2)}`);
    console.log(`--------------------------------------------------\n`);
}

function simulateTrade(candles, startIndex) {
    const entryPrice = candles[startIndex].open;
    for (let j = startIndex; j < candles.length; j++) {
        const high = candles[j].high;
        const low = candles[j].low;
        const profitHigh = ((high - entryPrice) / entryPrice) * MULTIPLIER * STAKE;
        const lossLow = ((low - entryPrice) / entryPrice) * MULTIPLIER * STAKE;

        if (profitHigh >= TP) return TP;
        if (lossLow <= -SL) return -SL;
    }
    return 0;
}
