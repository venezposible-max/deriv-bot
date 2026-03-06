const WebSocket = require('ws');

// ============================================
// CONFIGURACIÓN DEL BACKTESTING
// ============================================
const CONFIG = {
    stake: 20,
    multiplier: 40,

    // Spike Fade
    spikeFade_tp: 4.00,        // TP modesto post-spike
    spikeFade_sl: 8.00,        // SL más amplio (el retroceso puede tardar)
    spikeDetectThreshold: 0.35,// % de movimiento en 1 tick = spike

    // Drift Rider (operar la deriva entre spikes)
    drift_tp: 3.00,
    drift_sl: 6.00,
    driftConfirmTicks: 5,      // Ticks consecutivos confirmando la deriva
};

const SYMBOLS = [
    { name: 'BOOM500N',   type: 'BOOM',  spikeDir: 'UP',   driftDir: 'MULTDOWN', label: 'Boom 500' },
    { name: 'CRASH500N',  type: 'CRASH', spikeDir: 'DOWN', driftDir: 'MULTUP',   label: 'Crash 500' },
];

const APP_ID = 1089;
const HOURS_BACK = 24;
const START_BALANCE = 100.00;

// ============================================
// DETECTAR SPIKE EN UN SOLO TICK
// ============================================
function detectSpike(prevPrice, currentPrice, spikeDir, threshold) {
    const changePct = Math.abs((currentPrice - prevPrice) / prevPrice) * 100;
    if (changePct < threshold) return false;
    if (spikeDir === 'UP'   && currentPrice > prevPrice) return true;
    if (spikeDir === 'DOWN' && currentPrice < prevPrice) return true;
    return false;
}

// ============================================
// TRAILING STOP DINÁMICO ($0.50)
// ============================================
function getTrailingFloor(maxProfit) {
    if (maxProfit < 1.00) return -Infinity;
    const step = Math.floor(maxProfit / 0.50) * 0.50;
    return step - 0.50;
}

// ============================================
// SIMULADOR DE CONTRATO (Fade o Drift)
// ============================================
function simulateContract(dir, entryPrice, tp, sl, futureTicks) {
    let maxProfit = 0;
    let lastFloor = -Infinity;

    for (let i = 0; i < futureTicks.length; i++) {
        let delta = (futureTicks[i] - entryPrice) / entryPrice;
        if (dir === 'MULTDOWN') delta = -delta;
        const liveProfit = delta * CONFIG.multiplier * CONFIG.stake;

        if (liveProfit > maxProfit) maxProfit = liveProfit;
        const floor = getTrailingFloor(maxProfit);
        if (floor > lastFloor) lastFloor = floor;

        if (lastFloor > 0 && liveProfit <= lastFloor) {
            return { profit: liveProfit, reason: `Trailing ($${lastFloor.toFixed(2)})`, ticks: i + 1, maxProfit };
        }
        if (liveProfit >= tp) {
            return { profit: tp, reason: '✨ Take Profit', ticks: i + 1, maxProfit };
        }
        if (liveProfit <= -sl) {
            return { profit: -sl, reason: '❌ Stop Loss', ticks: i + 1, maxProfit };
        }
    }
    const lastTick = futureTicks[futureTicks.length - 1];
    let fd = (lastTick - entryPrice) / entryPrice;
    if (dir === 'MULTDOWN') fd = -fd;
    const fp = Math.max(-sl, Math.min(tp, fd * CONFIG.multiplier * CONFIG.stake));
    return { profit: fp, reason: 'Tiempo', ticks: futureTicks.length, maxProfit };
}

// ============================================
// BACKTESTING DE UN SÍMBOLO: 3 ESTRATEGIAS
// ============================================
function backtestSymbol(symbolConfig, ticks) {
    const { type, spikeDir, driftDir, label } = symbolConfig;
    const fadeCooldown = 30; // ticks de espera entre operaciones Fade
    const driftCooldown = 100;

    let results = {
        // Estrategia 1: Solo Spike Fade 
        fade: { balance: START_BALANCE, trades: [], cooldown: 0 },
        // Estrategia 2: Solo Drift Rider
        drift: { balance: START_BALANCE, trades: [], cooldown: 0 },
        // Estrategia 3: Combinada (Drift + Fade)
        combined: { balance: START_BALANCE, trades: [], cooldown: 0, inDrift: false },
    };

    let spikesDetected = 0;
    let lastSpikeIdx = -200;

    for (let i = 1; i < ticks.length - 3000; i++) {
        const prev = ticks[i - 1];
        const curr = ticks[i];
        const isSpike = detectSpike(prev, curr, spikeDir, CONFIG.spikeDetectThreshold);

        if (isSpike) {
            spikesDetected++;
            lastSpikeIdx = i;

            // ══════════════════════════════
            // ESTRATEGIA 1: SPIKE FADE
            // ══════════════════════════════
            if (results.fade.cooldown === 0) {
                // Fade = entrar en DIRECCIÓN OPUESTA al spike inmediatamente
                const fadeDir = spikeDir === 'UP' ? 'MULTDOWN' : 'MULTUP';
                const futureTicks = ticks.slice(i + 1, i + 400);
                const result = simulateContract(fadeDir, curr, CONFIG.spikeFade_tp, CONFIG.spikeFade_sl, futureTicks);
                results.fade.balance += result.profit;
                results.fade.trades.push({ strategy: 'Fade', type: fadeDir, profit: result.profit, reason: result.reason, maxProfit: result.maxProfit });
                results.fade.cooldown = fadeCooldown;

                const emoji = result.profit > 0 ? '✅' : '❌';
                console.log(`  [FADE ]${emoji} Spike ${spikeDir} detectado (${((Math.abs(curr-prev)/prev)*100).toFixed(2)}%) | ${fadeDir.padEnd(10)} | P&L: ${result.profit >= 0 ? '+' : ''}$${result.profit.toFixed(2).padStart(7)} | Max: $${result.maxProfit.toFixed(2)} | ${result.reason} | Saldo: $${results.fade.balance.toFixed(2)}`);
            }
        }

        // Bajar cooldowns
        if (results.fade.cooldown > 0)  results.fade.cooldown--;
        if (results.drift.cooldown > 0) results.drift.cooldown--;

        // ══════════════════════════════
        // ESTRATEGIA 2: DRIFT RIDER
        // Entrar en la deriva tranquila entre spikes
        // ══════════════════════════════
        if (!isSpike && results.drift.cooldown === 0 && (i - lastSpikeIdx) > 30) {
            // Verificar deriva con ticks consecutivos
            if (i >= CONFIG.driftConfirmTicks) {
                const recentTicks = ticks.slice(i - CONFIG.driftConfirmTicks, i + 1);
                const driftingDown = recentTicks.every((v, j) => j === 0 || v <= recentTicks[j-1]);
                const driftingUp   = recentTicks.every((v, j) => j === 0 || v >= recentTicks[j-1]);

                const correctDrift = (driftDir === 'MULTDOWN' && driftingDown) || 
                                     (driftDir === 'MULTUP'   && driftingUp);

                if (correctDrift) {
                    const futureTicks = ticks.slice(i + 1, i + 2000);
                    const result = simulateContract(driftDir, curr, CONFIG.drift_tp, CONFIG.drift_sl, futureTicks);
                    results.drift.balance += result.profit;
                    results.drift.trades.push({ strategy: 'Drift', type: driftDir, profit: result.profit, reason: result.reason, maxProfit: result.maxProfit });
                    results.drift.cooldown = driftCooldown;

                    const emoji = result.profit > 0 ? '✅' : '❌';
                    console.log(`  [DRIFT]${emoji} Deriva ${type} confirmada | ${driftDir.padEnd(10)} | P&L: ${result.profit >= 0 ? '+' : ''}$${result.profit.toFixed(2).padStart(7)} | Max: $${result.maxProfit.toFixed(2)} | ${result.reason} | Saldo: $${results.drift.balance.toFixed(2)}`);
                }
            }
        }
    }

    return { results, spikesDetected, label };
}

// ============================================
// DESCARGA DE TICKS PARA UN SÍMBOLO
// ============================================
function fetchTicks(symbol) {
    return new Promise((resolve, reject) => {
        const endEpoch = Math.floor(Date.now() / 1000);
        const startEpoch = endEpoch - (HOURS_BACK * 3600);
        const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
        let allTicks = [];
        let from = startEpoch;
        let done = false;

        function requestBatch() {
            ws.send(JSON.stringify({
                ticks_history: symbol,
                start: from,
                end: Math.min(from + 7200, endEpoch),
                style: 'ticks',
                count: 5000
            }));
        }

        ws.on('open', () => requestBatch());
        ws.on('message', (data) => {
            if (done) return;
            const msg = JSON.parse(data);
            if (msg.error) {
                console.log(`   ⚠️  Error con ${symbol}: ${msg.error.message} — Intentando formato alternativo...`);
                // Intentar con nombre alternativo
                reject(new Error(msg.error.message));
                ws.close();
                return;
            }
            if (msg.msg_type === 'history') {
                const prices = msg.history.prices.map(p => parseFloat(p));
                const times = msg.history.times;
                allTicks = allTicks.concat(prices);
                const lastTime = times[times.length - 1];
                process.stdout.write(`\r   ⬇️  ${symbol}: ${allTicks.length.toLocaleString()} ticks...`);

                if (lastTime >= endEpoch - 30 || prices.length < 50) {
                    done = true; process.stdout.write('\n'); ws.close(); resolve(allTicks);
                } else {
                    from = lastTime + 1;
                    setTimeout(requestBatch, 250);
                }
            }
        });
        ws.on('error', reject);
        ws.on('close', () => { if (!done && allTicks.length > 0) { done = true; resolve(allTicks); } });
        setTimeout(() => { if (!done) { done = true; ws.close(); resolve(allTicks); } }, 60000);
    });
}

// ============================================
// FUNCIÓN DE RESUMEN
// ============================================
function printSummary(label, stratName, trades, finalBalance) {
    const wins = trades.filter(t => t.profit > 0);
    const losses = trades.filter(t => t.profit < 0);
    const totalPnL = finalBalance - START_BALANCE;
    const wr = trades.length > 0 ? (wins.length / trades.length * 100).toFixed(1) : '0.0';
    const avgW = wins.length > 0 ? (wins.reduce((a,b)=>a+b.profit,0)/wins.length).toFixed(2) : '0.00';
    const avgL = losses.length > 0 ? Math.abs(losses.reduce((a,b)=>a+b.profit,0)/losses.length).toFixed(2) : '0.00';
    console.log(`   ${label} [${stratName.padEnd(6)}] | Ops: ${trades.length.toString().padStart(3)} | W:${wins.length} L:${losses.length} WR:${wr.padStart(5)}% | AvgW:+$${avgW} AvgL:-$${avgL} | P&L: ${totalPnL >= 0 ? '+' : ''}$${totalPnL.toFixed(2)} | Final: $${finalBalance.toFixed(2)}`);
}

// ============================================
// MAIN
// ============================================
async function runBacktest() {
    console.log('\n╔══════════════════════════════════════════════════════════════╗');
    console.log('║   BACKTESTING BOOM/CRASH — 3 ESTRATEGIAS vs 2 SÍMBOLOS      ║');
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log(`║  Stake: $${CONFIG.stake} | Mult: x${CONFIG.multiplier} | Capital: $${START_BALANCE} cada estrategia   ║`);
    console.log('║  Estrategia 1: SPIKE FADE (entrar en contra del spike)       ║');
    console.log('║  Estrategia 2: DRIFT RIDER (seguir la deriva entre spikes)   ║');
    console.log('╚══════════════════════════════════════════════════════════════╝\n');

    for (const symbolConfig of SYMBOLS) {
        console.log(`\n${'═'.repeat(70)}`);
        console.log(`📊 SIMULANDO: ${symbolConfig.label} (${symbolConfig.name})`);
        console.log('═'.repeat(70));

        let ticks;
        try {
            ticks = await fetchTicks(symbolConfig.name);
        } catch (e) {
            // Intentar con nombre alternativo
            const altName = symbolConfig.name.replace('N', '');
            console.log(`   Intentando ${altName}...`);
            try {
                ticks = await fetchTicks(altName);
                symbolConfig.name = altName;
            } catch (e2) {
                console.log(`   ❌ No se pudo descargar ${symbolConfig.label}. Saltando...`);
                continue;
            }
        }

        if (!ticks || ticks.length < 200) {
            console.log(`   ❌ Ticks insuficientes para ${symbolConfig.label}`);
            continue;
        }

        console.log(`   ✅ ${ticks.length.toLocaleString()} ticks. Analizando...\n`);
        const { results, spikesDetected } = backtestSymbol(symbolConfig, ticks);

        console.log(`\n   📌 Spikes detectados: ${spikesDetected}`);
        console.log('   ' + '─'.repeat(110));
        printSummary(symbolConfig.label, 'FADE',  results.fade.trades,  results.fade.balance);
        printSummary(symbolConfig.label, 'DRIFT', results.drift.trades, results.drift.balance);
    }

    console.log('\n╔══════════════════════════════════════════════════════════════╗');
    console.log('║                  RESUMEN COMPARATIVO FINAL                  ║');
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log(`║  Capital inicial en cada estrategia: $${START_BALANCE}                ║`);
    console.log(`║  Período: Últimas ${HOURS_BACK} horas en vivo                          ║`);
    console.log('╚══════════════════════════════════════════════════════════════╝\n');
}

runBacktest().catch(console.error);
