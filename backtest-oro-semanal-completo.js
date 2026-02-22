const WebSocket = require('ws');

const APP_ID = 1089;
const SYMBOL = 'frxXAUUSD';
const TIMEFRAME = 60; // M1
const SMA_20_PERIOD = 20;
const SMA_40_PERIOD = 40;
const STAKE = 10;
const MULTIPLIER = 40;
const TP = 1.0;
const SL = 2.0;

const daysToTest = [
    { name: 'Lunes 16/Feb', date: '2026-02-16' },
    { name: 'Martes 17/Feb', date: '2026-02-17' },
    { name: 'Miércoles 18/Feb', date: '2026-02-18' },
    { name: 'Jueves 19/Feb', date: '2026-02-19' },
    { name: 'Viernes 20/Feb', date: '2026-02-20' }
];

async function runBacktest(day) {
    return new Promise((resolve) => {
        const startTS = Math.floor(new Date(`${day.date}T00:00:00Z`).getTime() / 1000);
        const endTS = Math.floor(new Date(`${day.date}T23:59:59Z`).getTime() / 1000);

        const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

        ws.on('open', () => {
            ws.send(JSON.stringify({
                ticks_history: SYMBOL,
                end: endTS,
                start: startTS,
                count: 5000,
                granularity: TIMEFRAME,
                style: 'candles'
            }));
        });

        ws.on('message', (data) => {
            const msg = JSON.parse(data);
            if (msg.msg_type === 'candles') {
                const results = simulateDay(day.name, msg.candles);
                ws.close();
                resolve(results);
            }
        });
    });
}

function calculateSMA(data, period) {
    let smas = new Array(data.length).fill(null);
    for (let i = period - 1; i < data.length; i++) {
        let sum = 0;
        for (let j = 0; j < period; j++) sum += data[i - j].close;
        smas[i] = sum / period;
    }
    return smas;
}

function simulateDay(name, candles) {
    if (!candles || candles.length < SMA_40_PERIOD) return { name, total: 0, wins: 0, losses: 0, balance: 0 };

    const sma20 = calculateSMA(candles, SMA_20_PERIOD);
    const sma40 = calculateSMA(candles, SMA_40_PERIOD);

    let balance = 0, wins = 0, losses = 0, totalIdx = 0;
    let setup = false, resistance = 0;

    for (let i = SMA_40_PERIOD; i < candles.length - 1; i++) {
        const c = candles[i];
        if (sma20[i] > sma40[i]) {
            if (c.low <= sma40[i] * 1.0002) {
                setup = true;
                resistance = c.high;
                continue;
            }
            if (setup && c.close > resistance) {
                totalIdx++;
                const entry = candles[i + 1].open;
                let outcome = 0;
                for (let j = i + 1; j < candles.length; j++) {
                    const p = ((candles[j].high - entry) / entry) * MULTIPLIER * STAKE;
                    const l = ((candles[j].low - entry) / entry) * MULTIPLIER * STAKE;
                    if (p >= TP) { outcome = TP; break; }
                    if (l <= -SL) { outcome = -SL; break; }
                }
                balance += outcome;
                if (outcome > 0) wins++; else if (outcome < 0) losses++;
                setup = false;
                i += 15;
            } else if (setup) {
                if (c.high < resistance) resistance = c.high;
                if (c.close < sma40[i] * 0.998) setup = false;
            }
        } else setup = false;
    }
    return { name, total: totalIdx, wins, losses, balance };
}

async function main() {
    console.log(`\n🥇 REPORTE SEMANAL COMPLETO (ORO - ESTRATEGIA PM40)`);
    console.log(`====================================================`);
    console.log(`Configuración: TP $${TP} | SL $${SL} | Stake $${STAKE}`);
    console.log(`----------------------------------------------------`);

    let totalWin = 0, totalLoss = 0, totalBal = 0, totalTrades = 0;

    for (const day of daysToTest) {
        const res = await runBacktest(day);
        const wr = ((res.wins / res.total) * 100 || 0).toFixed(1);
        console.log(`${res.name}: $${res.balance.toFixed(2)} | Trades: ${res.total} | WR: ${wr}%`);

        totalWin += res.wins;
        totalLoss += res.losses;
        totalBal += res.balance;
        totalTrades += res.total;
    }

    console.log(`----------------------------------------------------`);
    console.log(`📊 RESUMEN FINAL DE LA SEMANA:`);
    console.log(`   Balance Total: $${totalBal.toFixed(2)} ${totalBal >= 0 ? '✅' : '❌'}`);
    console.log(`   Win Rate Total: ${((totalWin / totalTrades) * 100 || 0).toFixed(1)}%`);
    console.log(`   Operaciones totales: ${totalTrades}`);
    console.log(`====================================================\n`);
}

main();
