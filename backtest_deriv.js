const WebSocket = require('ws');

// ============================================
// PARÁMETROS EXACTOS DEL BOT (De la pantalla)
// ============================================
const CONFIG = {
    stake: 20,
    takeProfit: 10.00,
    stopLoss: 13.00,
    multiplier: 40,
    smaPeriod: 50,
    rsiPeriod: 14,
    momentum: 9,
    rsiLow: 25,
    rsiHigh: 75,
    useHybrid: true,
    hybridDistClose: 0.10,
    hybridDistFar: 0.20,
};

const SYMBOL = 'R_100';
const APP_ID = 1089;
const HOURS_BACK = 24;
const START_BALANCE = 326.94;

function calculateSMA(prices, period) {
    if (prices.length < period) return null;
    let sum = 0;
    for (let i = 0; i < period; i++) sum += prices[prices.length - 1 - i];
    return sum / period;
}

function calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) return 50;
    let gains = 0, losses = 0;
    for (let i = prices.length - period; i < prices.length; i++) {
        let diff = prices[i] - prices[i - 1];
        if (diff >= 0) gains += diff; else losses -= diff;
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    return 100 - (100 / (1 + avgGain / avgLoss));
}

function getTrailingFloor(maxProfit) {
    if (maxProfit < 1.00) return -Infinity;
    const currentStep = Math.floor(maxProfit / 0.50) * 0.50;
    return currentStep - 0.50;
}

function checkEntry(tickHistory) {
    if (tickHistory.length < Math.max(CONFIG.momentum, CONFIG.smaPeriod + 1)) return null;
    const quote = tickHistory[tickHistory.length - 1];
    const lastTicks = tickHistory.slice(-CONFIG.momentum);
    const allDown = lastTicks.every((v, i) => i === 0 || v < lastTicks[i - 1]);
    const allUp   = lastTicks.every((v, i) => i === 0 || v > lastTicks[i - 1]);

    if (!allUp && !allDown) return null;

    const sma = calculateSMA(tickHistory, CONFIG.smaPeriod);
    const rsi = calculateRSI(tickHistory, CONFIG.rsiPeriod);
    if (!sma) return null;

    const distPct = Math.abs(quote - sma) / sma * 100;

    if (distPct < CONFIG.hybridDistClose && rsi >= 40 && rsi <= 60) {
        if (allUp)   return { dir: 'MULTUP',   reason: 'SNIPER↑', rsi, dist: distPct };
        if (allDown) return { dir: 'MULTDOWN', reason: 'SNIPER↓', rsi, dist: distPct };
    } else if (distPct > CONFIG.hybridDistFar) {
        if (allUp   && rsi > CONFIG.rsiHigh) return { dir: 'MULTDOWN', reason: 'ALPHA↓', rsi, dist: distPct };
        if (allDown && rsi < CONFIG.rsiLow)  return { dir: 'MULTUP',   reason: 'ALPHA↑', rsi, dist: distPct };
    }
    return null;
}

function simulateContract(dir, entryPrice, futureTicks) {
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
            return { profit: CONFIG.takeProfit, reason: 'Take Profit', ticks: i + 1, maxProfit };
        }
        if (liveProfit <= -CONFIG.stopLoss) {
            return { profit: -CONFIG.stopLoss, reason: 'Stop Loss', ticks: i + 1, maxProfit };
        }
    }
    const lastTick = futureTicks[futureTicks.length - 1];
    let finalDelta = (lastTick - entryPrice) / entryPrice;
    if (dir === 'MULTDOWN') finalDelta = -finalDelta;
    const finalProfit = finalDelta * CONFIG.multiplier * CONFIG.stake;
    return { profit: Math.max(-CONFIG.stopLoss, Math.min(CONFIG.takeProfit, finalProfit)), reason: 'Tiempo', ticks: futureTicks.length, maxProfit };
}

function fetchTicks() {
    return new Promise((resolve, reject) => {
        const endEpoch = Math.floor(Date.now() / 1000);
        const startEpoch = endEpoch - (HOURS_BACK * 3600);

        const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
        let allTicks = [];
        let allTimes = [];
        let from = startEpoch;
        let done = false;

        function requestBatch() {
            const to = from + 7200; // 2h por batch
            ws.send(JSON.stringify({
                ticks_history: SYMBOL,
                start: from,
                end: Math.min(to, endEpoch),
                style: 'ticks',
                count: 5000
            }));
        }

        ws.on('open', () => {
            console.log('🔌 Conectado a Deriv. Descargando 24h de ticks de R_100...\n');
            requestBatch();
        });

        ws.on('message', (data) => {
            if (done) return;
            const msg = JSON.parse(data);
            if (msg.error) { console.error('API Error:', msg.error.message); reject(new Error(msg.error.message)); ws.close(); return; }
            if (msg.msg_type === 'history') {
                const prices = msg.history.prices.map(p => parseFloat(p));
                const times  = msg.history.times;

                allTicks = allTicks.concat(prices);
                allTimes = allTimes.concat(times);

                const lastTime = times[times.length - 1];
                process.stdout.write(`\r   ⬇️  Descargados: ${allTicks.length.toLocaleString()} ticks (hasta ${new Date(lastTime * 1000).toLocaleTimeString()})...`);

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

        ws.on('error', (e) => { if (!done) reject(e); });
        ws.on('close', () => { if (!done && allTicks.length > 0) { done = true; resolve(allTicks); } });
        setTimeout(() => { if (!done) { done = true; ws.close(); resolve(allTicks); } }, 60000);
    });
}

async function runBacktest() {
    console.log('\n╔══════════════════════════════════════════════════════╗');
    console.log('║      BACKTESTING SNIPER PRO HÍBRIDO — R_100          ║');
    console.log('╚══════════════════════════════════════════════════════╝');
    console.log(`   Stake: $${CONFIG.stake} | TP: $${CONFIG.takeProfit} | SL: $${CONFIG.stopLoss} | Mult: x${CONFIG.multiplier}`);
    console.log(`   Momentum: ${CONFIG.momentum} ticks | Modo: HÍBRIDO | Saldo Inicial: $${START_BALANCE}\n`);

    const ticks = await fetchTicks();
    if (!ticks || ticks.length < 200) {
        console.error('❌ No hay suficientes ticks. Verifica conexión a internet.');
        return;
    }
    console.log(`\n✅ ${ticks.length.toLocaleString()} ticks descargados. Simulando...\n`);

    let balance = START_BALANCE;
    let trades = [];
    let tickWindow = [];
    let cooldown = 0;

    for (let i = 0; i < ticks.length - 600; i++) {
        tickWindow.push(ticks[i]);
        if (tickWindow.length > 400) tickWindow.shift();
        if (cooldown > 0) { cooldown--; continue; }

        const signal = checkEntry(tickWindow);
        if (!signal) continue;

        const entryPrice = ticks[i];
        const futureTicks = ticks.slice(i + 1, i + 3000); // ~50 minutos para dar tiempo real al SL/TP
        const result = simulateContract(signal.dir, entryPrice, futureTicks);
        balance += result.profit;

        trades.push({ ...signal, ...result, balance });

        const emoji = result.profit > 0 ? '✅' : (result.profit === 0 ? '⚪' : '❌');
        console.log(
            `${emoji} [${trades.length.toString().padStart(3)}] ${signal.dir.padEnd(10)} ` +
            `${signal.reason.padEnd(9)} RSI:${parseFloat(signal.rsi).toFixed(0).padStart(3)} ` +
            `| P&L: ${result.profit >= 0 ? '+' : ''}$${result.profit.toFixed(2).padStart(7)} ` +
            `| Max: $${result.maxProfit.toFixed(2).padStart(6)} ` +
            `| ${result.reason.padEnd(22)} | Saldo: $${balance.toFixed(2)}`
        );

        cooldown = 60;
    }

    const wins   = trades.filter(t => t.profit > 0);
    const losses = trades.filter(t => t.profit < 0);
    const breaks = trades.filter(t => t.profit === 0);
    const totalPnL = balance - START_BALANCE;
    const winRate  = trades.length > 0 ? (wins.length / trades.length * 100) : 0;
    const avgWin   = wins.length > 0   ? wins.reduce((a, b) => a + b.profit, 0) / wins.length : 0;
    const avgLoss  = losses.length > 0 ? Math.abs(losses.reduce((a, b) => a + b.profit, 0) / losses.length) : 0;
    const sharpe   = avgLoss > 0 ? (avgWin / avgLoss).toFixed(2) : 'N/A';

    const alphaOps  = trades.filter(t => t.reason.includes('ALPHA'));
    const sniperOps = trades.filter(t => t.reason.includes('SNIPER'));
    const alphaWR   = alphaOps.length > 0 ? (alphaOps.filter(t => t.profit > 0).length / alphaOps.length * 100).toFixed(1) : 0;
    const sniperWR  = sniperOps.length > 0 ? (sniperOps.filter(t => t.profit > 0).length / sniperOps.length * 100).toFixed(1) : 0;

    const trailingClosures = trades.filter(t => t.closeReason && t.closeReason.includes('Trailing') || t.reason.includes('Trailing'));

    console.log('\n╔══════════════════════════════════════════════════════╗');
    console.log('║           RESUMEN FINAL — ÚLTIMAS 24 HORAS           ║');
    console.log('╠══════════════════════════════════════════════════════╣');
    console.log(`║  💰 Saldo Inicial:      $${START_BALANCE.toFixed(2).padStart(8)}                    ║`);
    console.log(`║  💰 Saldo Final:        $${balance.toFixed(2).padStart(8)}                    ║`);
    console.log(`║  📈 P&L Total:         ${(totalPnL >= 0 ? '+' : '') + '$' + totalPnL.toFixed(2)  }                      ║`);
    console.log(`║  📉 Retorno %:          ${((totalPnL / START_BALANCE) * 100).toFixed(2).padStart(7)}%                    ║`);
    console.log('╠══════════════════════════════════════════════════════╣');
    console.log(`║  📋 Total Operaciones:  ${trades.length.toString().padStart(4)}                          ║`);
    console.log(`║  ✅ Victorias:          ${wins.length.toString().padStart(4)} (${winRate.toFixed(1)}%)               ║`);
    console.log(`║  ❌ Derrotas:           ${losses.length.toString().padStart(4)} (${(100 - winRate - breaks.length/trades.length*100).toFixed(1)}%)               ║`);
    console.log(`║  📊 Ganancia Media:    +$${avgWin.toFixed(2).padStart(7)}                    ║`);
    console.log(`║  📊 Pérdida Media:     -$${avgLoss.toFixed(2).padStart(7)}                    ║`);
    console.log(`║  ⚖️  Ratio Riesgo:        ${sharpe}                          ║`);
    console.log('╠══════════════════════════════════════════════════════╣');
    console.log(`║  ⚔️  Modo Alpha:  ${alphaOps.length.toString().padStart(3)} ops | Win Rate: ${alphaWR}%           ║`);
    console.log(`║  🎯 Modo Sniper: ${sniperOps.length.toString().padStart(3)} ops | Win Rate: ${sniperWR}%           ║`);
    console.log('╚══════════════════════════════════════════════════════╝');
}

runBacktest().catch(console.error);
