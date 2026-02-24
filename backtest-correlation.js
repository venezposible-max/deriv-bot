const WebSocket = require('ws');
const APP_ID = 1089;
const SYMBOL_LEAD = '1HZ10V'; // Volatility 10 (1s)
const SYMBOL_TRADE = 'R_100';  // Volatility 100

const CONFIG = {
    stake: 20,
    multiplier: 100,
    momentum: 10,
    lagSeconds: 2,
    stopLoss: 3.0,
    takeProfit: 10.0
};

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
let dataLead = { prices: [], times: [] };
let dataTrade = { prices: [], times: [] };
const TARGET_TICKS = 90000; // ~25 horas

ws.on('open', () => {
    console.log("📡 Iniciando Descarga de 24 HORAS: V10(1s) vs V100...");
    fetchHistory(SYMBOL_LEAD);
});

function fetchHistory(symbol, beforeEpoch = null) {
    ws.send(JSON.stringify({
        ticks_history: symbol,
        adjust_start_time: 1,
        count: 5000,
        end: beforeEpoch || 'latest',
        style: 'ticks'
    }));
}

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.msg_type === 'history') {
        const symbol = msg.echo_req.ticks_history;
        const prices = msg.history.prices;
        const times = msg.history.times;

        if (symbol === SYMBOL_LEAD) {
            dataLead.prices = [...prices, ...dataLead.prices];
            dataLead.times = [...times, ...dataLead.times];
            if (dataLead.prices.length < TARGET_TICKS) {
                fetchHistory(SYMBOL_LEAD, times[0]);
            } else {
                console.log(`✅ Historial V10(1s) cargado (${dataLead.prices.length} ticks).`);
                fetchHistory(SYMBOL_TRADE);
            }
        } else {
            dataTrade.prices = [...prices, ...dataTrade.prices];
            dataTrade.times = [...times, ...dataTrade.times];
            if (dataTrade.prices.length < TARGET_TICKS) {
                fetchHistory(SYMBOL_TRADE, times[0]);
            } else {
                console.log(`✅ Historial V100 cargado (${dataTrade.prices.length} ticks).`);
                runAdvancedSim();
                ws.close();
            }
        }
    }
});

function runAdvancedSim() {
    let balanceDir = 0, winsDir = 0, lossesDir = 0;
    let balanceInv = 0, winsInv = 0, lossesInv = 0;
    let totalTrades = 0;

    console.log("\n🔍 Simulando 24 Horas de Correlación Directa vs Inversa...");

    for (let i = 200; i < dataLead.prices.length - 100; i++) {
        // Buscamos un clímax: Nuevo máximo de los últimos 200 ticks
        const window = dataLead.prices.slice(i - 200, i);
        const max = Math.max(...window);
        const min = Math.min(...window);

        let signal = null;
        if (dataLead.prices[i] > max) signal = 'UP';
        else if (dataLead.prices[i] < min) signal = 'DOWN';

        if (signal) {
            const entryTime = dataLead.times[i] + CONFIG.lagSeconds;
            // Optimización de búsqueda
            const tradeIdx = dataTrade.times.findIndex(t => t >= entryTime);
            if (tradeIdx === -1 || tradeIdx + 50 >= dataTrade.prices.length) continue;

            const entryPrice = dataTrade.prices[tradeIdx];
            const exitPrice = dataTrade.prices[tradeIdx + 50];

            // Eval MODO DIRECTO
            let pnlDir = (exitPrice - entryPrice) / entryPrice;
            if (signal === 'DOWN') pnlDir = -pnlDir;
            let profitDir = pnlDir * CONFIG.multiplier * CONFIG.stake;
            if (profitDir > CONFIG.takeProfit) profitDir = CONFIG.takeProfit;
            if (profitDir < -CONFIG.stopLoss) profitDir = -CONFIG.stopLoss;
            balanceDir += profitDir;
            if (profitDir > 0) winsDir++; else lossesDir++;

            // Eval MODO INVERSO
            let profitInv = -profitDir;
            if (profitInv > CONFIG.takeProfit) profitInv = CONFIG.takeProfit;
            if (profitInv < -CONFIG.stopLoss) profitInv = -CONFIG.stopLoss;
            balanceInv += profitInv;
            if (profitInv > 0) winsInv++; else lossesInv++;

            totalTrades++;
            i += 500; // Cooldown para solo capturar quiebres mayores
        }
    }

    console.log(`====================================================`);
    console.log(`📊 REPORTE FINAL: 24 HORAS DE CORRELACIÓN`);
    console.log(`Filtro: Quiebre de Estructura de 200 ticks`);
    console.log(`====================================================`);
    console.log(`Operaciones: ${totalTrades}`);
    console.log(`----------------------------------------------------`);
    console.log(`🚀 [MODO DIRECTO (RECOMENDADO)]`);
    console.log(`PnL Acumulado: $${balanceDir.toFixed(2)}`);
    console.log(`Efectividad: ${((winsDir / totalTrades) * 100).toFixed(1)}%`);
    console.log(`----------------------------------------------------`);
    console.log(`🔮 [MODO INVERSO (MITO)]`);
    console.log(`PnL Acumulado: $${balanceInv.toFixed(2)}`);
    console.log(`Efectividad: ${((winsInv / totalTrades) * 100).toFixed(1)}%`);
    console.log(`====================================================\n`);
}
