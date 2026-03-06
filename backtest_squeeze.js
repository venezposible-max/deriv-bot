const WebSocket = require('ws');

// ============================================
// PARÁMETROS DEL SQUEEZE BREAKOUT
// ============================================
const CONFIG = {
    // Contrato
    stake: 20,
    takeProfit: 10.00,
    stopLoss: 6.00,    // SL más corto → pérdidas más pequeñas
    multiplier: 40,

    // Bollinger Bands
    bbPeriod: 20,
    bbStdDev: 2.5,

    // Squeeze: cuándo el mercado está "dormido"
    squeezeThresholdPct: 0.40, // BBW debe estar por debajo del 40% de su promedio histórico
    bbwLookback: 50,           // Comparar contra las últimas 50 velas en ancho

    // Breakout: confirmación de la explosión
    breakoutTicks: 3,          // 3 ticks consecutivos fuera de la banda
    momentum: 5,               // Ticks de momentum en la misma dirección tras el breakout
};

const SYMBOL = 'R_100';
const APP_ID = 1089;
const HOURS_BACK = 24;
const START_BALANCE = 326.94;

// ============================================
// FUNCIONES TÉCNICAS - BOLLINGER BANDS
// ============================================
function calculateBB(prices, period, stdDevMult) {
    if (prices.length < period) return null;
    const slice = prices.slice(-period);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / period;
    const stdDev = Math.sqrt(variance);
    return {
        upper: mean + stdDevMult * stdDev,
        lower: mean - stdDevMult * stdDev,
        middle: mean,
        width: ((mean + stdDevMult * stdDev) - (mean - stdDevMult * stdDev)) / mean * 100, // BBW%
        stdDev
    };
}

// ============================================
// LÓGICA DE SEÑAL: SQUEEZE + BREAKOUT
// ============================================
function checkSqueezeBreakout(tickHistory, bbwHistory) {
    if (tickHistory.length < CONFIG.bbPeriod + CONFIG.bbwLookback + CONFIG.breakoutTicks) return null;

    const quote = tickHistory[tickHistory.length - 1];

    // 1. Calcular Bollinger Bands actuales
    const bb = calculateBB(tickHistory, CONFIG.bbPeriod, CONFIG.bbStdDev);
    if (!bb) return null;

    // 2. ¿Estábamos en SQUEEZE antes del último tick? (BBW histórico)
    if (bbwHistory.length < CONFIG.bbwLookback) return null;
    const avgBBW = bbwHistory.slice(-CONFIG.bbwLookback).reduce((a, b) => a + b, 0) / CONFIG.bbwLookback;
    const prevBBW = bbwHistory[bbwHistory.length - 1];

    // El squeeze se define como: el ancho anterior era bajo MAS ahora está empezando a EXPANDIRSE
    const wasInSqueeze = prevBBW < (avgBBW * CONFIG.squeezeThresholdPct);

    if (!wasInSqueeze) return null;

    // 3. ¿El precio actual rompió fuera de la banda? (Breakout)
    const brokeUp   = quote > bb.upper;
    const brokeDown = quote < bb.lower;

    if (!brokeUp && !brokeDown) return null;

    // 4. ¿Hay momentum en esa dirección? (últimos N ticks todos en la misma dirección)
    const recentTicks = tickHistory.slice(-CONFIG.momentum);
    const allUp   = recentTicks.every((v, i) => i === 0 || v >= recentTicks[i - 1]);
    const allDown = recentTicks.every((v, i) => i === 0 || v <= recentTicks[i - 1]);

    if (brokeUp && allUp) {
        return {
            dir: 'MULTUP',
            reason: 'SQUEEZE↑',
            bbw: prevBBW.toFixed(3),
            avgBBW: avgBBW.toFixed(3),
            bb,
            quote
        };
    }
    if (brokeDown && allDown) {
        return {
            dir: 'MULTDOWN',
            reason: 'SQUEEZE↓',
            bbw: prevBBW.toFixed(3),
            avgBBW: avgBBW.toFixed(3),
            bb,
            quote
        };
    }

    return null;
}

// ============================================
// SIMULADOR DE CONTRATO CON TRAILING $0.50
// ============================================
function getTrailingFloor(maxProfit) {
    if (maxProfit < 1.00) return -Infinity;
    const step = Math.floor(maxProfit / 0.50) * 0.50;
    return step - 0.50;
}

function simulateContract(dir, entryPrice, bb, futureTicks) {
    let maxProfit = 0;
    let lastFloor = -Infinity;

    for (let i = 0; i < futureTicks.length; i++) {
        let priceDelta = (futureTicks[i] - entryPrice) / entryPrice;
        if (dir === 'MULTDOWN') priceDelta = -priceDelta;
        const liveProfit = priceDelta * CONFIG.multiplier * CONFIG.stake;

        if (liveProfit > maxProfit) maxProfit = liveProfit;

        const floor = getTrailingFloor(maxProfit);
        if (floor > lastFloor) lastFloor = floor;

        if (lastFloor > 0 && liveProfit <= lastFloor) {
            return { profit: liveProfit, reason: `Trailing ($${lastFloor.toFixed(2)})`, ticks: i + 1, maxProfit };
        }
        if (liveProfit >= CONFIG.takeProfit) {
            return { profit: CONFIG.takeProfit, reason: 'Take Profit ✨', ticks: i + 1, maxProfit };
        }
        if (liveProfit <= -CONFIG.stopLoss) {
            return { profit: -CONFIG.stopLoss, reason: 'Stop Loss', ticks: i + 1, maxProfit };
        }
    }
    const lastTick = futureTicks[futureTicks.length - 1];
    let finalDelta = (lastTick - entryPrice) / entryPrice;
    if (dir === 'MULTDOWN') finalDelta = -finalDelta;
    const fp = Math.max(-CONFIG.stopLoss, Math.min(CONFIG.takeProfit, finalDelta * CONFIG.multiplier * CONFIG.stake));
    return { profit: fp, reason: 'Tiempo', ticks: futureTicks.length, maxProfit };
}

// ============================================
// DESCARGA DE TICKS DE DERIV (24h)
// ============================================
function fetchTicks() {
    return new Promise((resolve, reject) => {
        const endEpoch = Math.floor(Date.now() / 1000);
        const startEpoch = endEpoch - (HOURS_BACK * 3600);
        const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
        let allTicks = [];
        let from = startEpoch;
        let done = false;

        function requestBatch() {
            const to = from + 7200;
            ws.send(JSON.stringify({
                ticks_history: SYMBOL,
                start: from,
                end: Math.min(to, endEpoch),
                style: 'ticks',
                count: 5000
            }));
        }

        ws.on('open', () => {
            console.log('🔌 Conectado a Deriv. Descargando 24h de ticks R_100...\n');
            requestBatch();
        });

        ws.on('message', (data) => {
            if (done) return;
            const msg = JSON.parse(data);
            if (msg.error) { reject(new Error(msg.error.message)); ws.close(); return; }
            if (msg.msg_type === 'history') {
                const prices = msg.history.prices.map(p => parseFloat(p));
                const times = msg.history.times;
                allTicks = allTicks.concat(prices);
                const lastTime = times[times.length - 1];
                process.stdout.write(`\r   ⬇️  ${allTicks.length.toLocaleString()} ticks (hasta ${new Date(lastTime * 1000).toLocaleTimeString()})...`);

                if (lastTime >= endEpoch - 30 || prices.length < 50) {
                    done = true;
                    process.stdout.write('\n');
                    ws.close();
                    resolve(allTicks);
                } else {
                    from = lastTime + 1;
                    setTimeout(requestBatch, 300);
                }
            }
        });

        ws.on('error', reject);
        ws.on('close', () => { if (!done && allTicks.length > 0) { done = true; resolve(allTicks); } });
        setTimeout(() => { if (!done) { done = true; ws.close(); resolve(allTicks); } }, 60000);
    });
}

// ============================================
// MAIN: BACKTESTING
// ============================================
async function runBacktest() {
    console.log('\n╔══════════════════════════════════════════════════════════╗');
    console.log('║   BACKTESTING — BOLLINGER SQUEEZE BREAKOUT vs SNIPER     ║');
    console.log('╚══════════════════════════════════════════════════════════╝');
    console.log(`   Stake: $${CONFIG.stake} | TP: $${CONFIG.takeProfit} | SL: $${CONFIG.stopLoss} | Mult: x${CONFIG.multiplier}`);
    console.log(`   BB: ${CONFIG.bbPeriod} períodos, ${CONFIG.bbStdDev}σ | Squeeze: <${CONFIG.squeezeThresholdPct*100}% del avg BBW\n`);

    const ticks = await fetchTicks();
    if (!ticks || ticks.length < 500) {
        console.error('❌ No hay suficientes ticks.');
        return;
    }
    console.log(`\n✅ ${ticks.length.toLocaleString()} ticks descargados. Simulando Squeeze Breakout...\n`);
    console.log('─'.repeat(100));

    let balance = START_BALANCE;
    let trades = [];
    let tickWindow = [];
    let bbwHistory = [];
    let cooldown = 0;

    for (let i = 0; i < ticks.length - 3000; i++) {
        tickWindow.push(ticks[i]);
        if (tickWindow.length > 300) tickWindow.shift();

        // Calcular y registrar el BBW en cada tick para el histórico de "squeeze"
        if (tickWindow.length >= CONFIG.bbPeriod) {
            const bb = calculateBB(tickWindow, CONFIG.bbPeriod, CONFIG.bbStdDev);
            if (bb) {
                bbwHistory.push(bb.width);
                if (bbwHistory.length > 500) bbwHistory.shift();
            }
        }

        if (cooldown > 0) { cooldown--; continue; }

        const signal = checkSqueezeBreakout(tickWindow, bbwHistory);
        if (!signal) continue;

        const entryPrice = ticks[i];
        const futureTicks = ticks.slice(i + 1, i + 3000);
        const result = simulateContract(signal.dir, entryPrice, signal.bb, futureTicks);
        balance += result.profit;

        trades.push({ ...signal, ...result, balance });

        const emoji = result.profit >= CONFIG.takeProfit ? '🚀' : result.profit > 0 ? '✅' : '❌';
        console.log(
            `${emoji} [${trades.length.toString().padStart(3)}] ${signal.dir.padEnd(10)} ` +
            `${signal.reason.padEnd(10)} ` +
            `BBW: ${parseFloat(signal.bbw).toFixed(3).padStart(6)} avg: ${parseFloat(signal.avgBBW).toFixed(3)} ` +
            `| P&L: ${result.profit >= 0 ? '+' : ''}$${result.profit.toFixed(2).padStart(7)} ` +
            `| Max: $${result.maxProfit.toFixed(2).padStart(6)} ` +
            `| ${result.reason.padEnd(22)} ` +
            `| Saldo: $${balance.toFixed(2)}`
        );

        // Cooldown más largo entre operaciones del Squeeze (operaciones menos frecuentes)
        cooldown = 120;
    }

    // ============================================
    // RESUMEN Y COMPARACIÓN
    // ============================================
    const wins   = trades.filter(t => t.profit > 0);
    const losses = trades.filter(t => t.profit < 0);
    const tps    = trades.filter(t => t.profit >= CONFIG.takeProfit);
    const totalPnL = balance - START_BALANCE;
    const winRate  = trades.length > 0 ? (wins.length / trades.length * 100) : 0;
    const avgWin   = wins.length   > 0 ? wins.reduce((a, b)   => a + b.profit, 0) / wins.length : 0;
    const avgLoss  = losses.length > 0 ? Math.abs(losses.reduce((a, b) => a + b.profit, 0) / losses.length) : 0;
    const rr       = avgLoss > 0 ? (avgWin / avgLoss).toFixed(2) : 'N/A';

    console.log('\n╔══════════════════════════════════════════════════════════╗');
    console.log('║              SQUEEZE BREAKOUT — RESULTADOS 24H           ║');
    console.log('╠══════════════════════════════════════════════════════════╣');
    console.log(`║  💰 Saldo Inicial:       $${START_BALANCE.toFixed(2).padStart(8)}                      ║`);
    console.log(`║  💰 Saldo Final:         $${balance.toFixed(2).padStart(8)}                      ║`);
    console.log(`║  📈 P&L Total:          ${(totalPnL >= 0 ? '+' : '') + '$' + totalPnL.toFixed(2)}                        ║`);
    console.log(`║  📉 Retorno %:           ${((totalPnL / START_BALANCE) * 100).toFixed(2).padStart(7)}%                      ║`);
    console.log('╠══════════════════════════════════════════════════════════╣');
    console.log(`║  📋 Total Operaciones:   ${trades.length.toString().padStart(4)}                            ║`);
    console.log(`║  ✅ Victorias:           ${wins.length.toString().padStart(4)} (${winRate.toFixed(1)}%)                 ║`);
    console.log(`║  ❌ Derrotas:            ${losses.length.toString().padStart(4)} (${(100 - winRate).toFixed(1)}%)                 ║`);
    console.log(`║  🚀 Take Profit Plenos:  ${tps.length.toString().padStart(4)}                            ║`);
    console.log(`║  📊 Ganancia Media:     +$${avgWin.toFixed(2).padStart(7)}                      ║`);
    console.log(`║  📊 Pérdida Media:      -$${avgLoss.toFixed(2).padStart(7)}                      ║`);
    console.log(`║  ⚖️  Ratio R:R:           ${rr.padStart(7)}                      ║`);
    console.log('╠══════════════════════════════════════════════════════════╣');
    console.log('║  📊 COMPARACIÓN vs SISTEMA ACTUAL (Alpha/Sniper)         ║');
    console.log('╠══════════════════════════════════════════════════════════╣');
    console.log(`║  Sniper P&L 24h:       +$41.06  (59 ops, 98.3% WR)      ║`);
    console.log(`║  Squeeze P&L 24h:      ${(totalPnL >= 0 ? '+' : '') + '$' + totalPnL.toFixed(2).padStart(7)}  (${trades.length.toString().padStart(2)} ops, ${winRate.toFixed(1).padStart(4)}% WR)      ║`);
    console.log(`║  Ganancia extra:       ${(totalPnL >= 0 ? '+' : '') + '$' + (totalPnL - 41.06 >= 0 ? '+' : '') + (totalPnL - 41.06).toFixed(2)}                          ║`);
    console.log('╚══════════════════════════════════════════════════════════╝');
}

runBacktest().catch(console.error);
