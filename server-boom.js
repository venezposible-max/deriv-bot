const WebSocket = require('ws');
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// ==========================================
// CONFIGURACIÓN: BOOM 1000 SNIPER 2026
// ==========================================
const APP_ID = 1089;
const SYMBOL = 'BOOM1000'; // El Rey de las Explosiones
const STATE_FILE = path.join(__dirname, 'persistent-state-boom.json');

// --- ESTRATEGIA: SNIPER DE SPIKES (Seguro para $85) ---
let BOOM_CONFIG = {
    stake: 20,          // Mantener stake para el multiplicador
    takeProfit: 50.00,  // Buscamos la ballena
    stopLoss: 0.20,     // BALA CONTROLADA: Perderemos máximo esto si no hay spike
    multiplier: 100,    // Multiplicador estándar para Boom
    rsiPeriod: 14,
    cciPeriod: 14,
    timeStopTicks: 15,  // El secreto: Solo esperamos 15 ticks por la explosión
    cooldownSeconds: 45 // Descanso entre intentos
};

let botState = {
    isRunning: true,
    balance: 0,
    pnlSession: 0,
    winsSession: 0,
    lossesSession: 0,
    totalTradesSession: 0,
    tradeHistory: [],
    balanceHistory: [],
    activeContracts: [],
    currentContractId: null,
    activeSymbol: 'BOOM1000',
    activeStrategy: 'SNIPER',
    cooldownRemaining: 0,
    lastScanLogTime: 0,
    sessionDuration: 0
};

let tickHistory = [];
let ws;
let isBuying = false;

// --- INICIALIZACIÓN DE SERVIDOR WEB PARA RAILWAY ---
const app = express();
app.use(cors());
app.use(express.json());

// --- DINAMIC BRANDING: BOOM 1000 ---
app.get('/', (req, res) => {
    let html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
    // Inyectamos un script al final del body para cambiar el branding
    const brandingScript = `
    <script>
        window.onload = () => {
            const replaceText = () => {
                document.title = "BOOM 1000 SNIPER 💥"; 
                const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
                let node;
                while (node = walker.nextNode()) {
                    if (node.nodeValue.includes('Step Index')) {
                        node.nodeValue = node.nodeValue.replace(/Step Index/g, 'BOOM 1000');
                    }
                }
            };
            replaceText();
            setInterval(replaceText, 2000); // Mantener el branding si React re-renderiza
        };
    </script>
    `;
    res.send(html.replace('</body>', brandingScript + '</body>'));
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/status', (req, res) => {
    res.json({
        success: true,
        data: {
            ...botState,
            activeSymbol: SYMBOL,
            activeStrategy: 'SNIPER'
        },
        config: BOOM_CONFIG,
        isSniper: true
    });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`\n🚀 Iniciando Motor BOOM 1000 SNIPER...`);
    console.log(`🌍 Módulo Web en puerto ${PORT}`);

    // --- CRONÓMETRO DE SESIÓN ---
    setInterval(() => { if (botState.isRunning) botState.sessionDuration++; }, 1000);

    connectWebSocket();
});

// --- INDICADORES TÉCNICOS ---
function calculateSMA(prices, period) {
    if (prices.length < period) return null;
    return prices.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function calculateRSI(prices, period) {
    if (prices.length < period + 1) return 50;
    let gains = 0, losses = 0;
    for (let i = prices.length - period; i < prices.length; i++) {
        let diff = prices[i] - prices[i - 1];
        if (diff >= 0) gains += diff; else losses -= diff;
    }
    let rs = (gains / period) / (losses / period || 1);
    return 100 - (100 / (1 + rs));
}

function calculateCCI(prices, period) {
    if (prices.length < period) return 0;
    const sma = calculateSMA(prices, period);
    let meanDev = 0;
    const slice = prices.slice(-period);
    for (let p of slice) meanDev += Math.abs(p - sma);
    meanDev = meanDev / period;
    if (meanDev === 0) return 0;
    return (prices[prices.length - 1] - sma) / (0.015 * meanDev);
}

// --- LÓGICA DE CONEXIÓN Y MERCADO ---
function connectWebSocket() {
    ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

    ws.on('open', () => {
        console.log(`✅ Socket Abierto. Autorizando con Token...`);
        ws.send(JSON.stringify({ authorize: process.env.DERIV_TOKEN || 'GzEO8iO7Y3N9Ym0' }));
    });

    ws.on('message', (data) => {
        const msg = JSON.parse(data);

        if (msg.msg_type === 'authorize') {
            console.log(`✅ DERIV CONECTADO - Usuario: ${msg.authorize.fullname}`);
            ws.send(JSON.stringify({ subscribe: 1, ticks: SYMBOL }));
            ws.send(JSON.stringify({ balance: 1, subscribe: 1 }));
        }

        if (msg.msg_type === 'balance') {
            botState.balance = msg.balance.balance;
            console.log(`💰 SALDO: $${botState.balance.toFixed(2)}`);
        }

        if (msg.msg_type === 'tick') {
            const quote = parseFloat(msg.tick.quote);
            tickHistory.push(quote);
            if (tickHistory.length > 500) tickHistory.shift();

            processTick(quote);
        }

        if (msg.msg_type === 'proposal_open_contract') {
            const contract = msg.proposal_open_contract;

            // Actualizar contrato activo para la UI
            if (contract && !contract.is_sold) {
                botState.currentContractId = contract.contract_id;
                botState.activeContracts = [contract];
            }

            if (contract && contract.is_sold) {
                finalizeTrade(contract);
            } else if (contract && !contract.is_sold) {
                // Monitoreo de Time-Stop
                const ticksElapsed = tickHistory.length - (botState.entryTickIdx || 0);
                const profit = parseFloat(contract.profit);

                // Si no hay spike en 15 ticks, cerramos con la "bala" de $0.20 - $1.00
                if (ticksElapsed >= BOOM_CONFIG.timeStopTicks && profit < 2.00) {
                    console.log(`🛡️ TIME-STOP: No hubo spike en ${BOOM_CONFIG.timeStopTicks} ticks. Abortando misión.`);
                    ws.send(JSON.stringify({ sell: contract.contract_id, price: 0 }));
                }
            }
        }
    });
}

function processTick(quote) {
    if (!botState.isRunning || botState.currentContractId || botState.cooldownRemaining > 0 || isBuying) {
        // Log de escaneo cada 30 segundos
        const now = Date.now();
        if (now - botState.lastScanLogTime > 30000) {
            console.log(`🔍 BOOM SCAN: RSI: ${calculateRSI(tickHistory, 14).toFixed(1)} | Cooldown: ${botState.cooldownRemaining}s | Memoria: ${tickHistory.length}/500`);
            botState.lastScanLogTime = now;
        }
        return;
    }

    const rsi = calculateRSI(tickHistory, 14);
    const cci = calculateCCI(tickHistory, 14);
    const sma50 = calculateSMA(tickHistory, 50);

    if (!sma50) return;

    // --- REGLAS SNIPER BOOM ---
    const distSMA = Math.abs(quote - sma50) / sma50 * 100;

    if (rsi < 25 && cci > -150 && distSMA < 0.12) {
        console.log(`💥 SEÑAL DETECTADA: RSI: ${rsi.toFixed(1)} | CCI: ${cci.toFixed(0)} | ¡FUEGO!`);
        executeTrade();
    }
}

function executeTrade() {
    isBuying = true;
    const req = {
        buy: 1,
        subscribe: 1,
        price: BOOM_CONFIG.stake,
        parameters: {
            amount: BOOM_CONFIG.stake,
            basis: 'stake',
            contract_type: 'MULTUP',
            currency: 'USD',
            symbol: SYMBOL,
            multiplier: BOOM_CONFIG.multiplier
        }
    };
    ws.send(JSON.stringify(req));

    // Registrar el índice del tick de entrada para el Time-Stop
    botState.entryTickIdx = tickHistory.length;

    setTimeout(() => { isBuying = false; }, 2000);
}

function finalizeTrade(contract) {
    const profit = parseFloat(contract.profit);
    botState.pnlSession += profit;
    botState.totalTradesSession++;
    if (profit > 0) {
        botState.winsSession++;
        console.log(`🎯 ¡SPIKE CAZADO! Ganancia: +$${profit.toFixed(2)} 💰💰💰`);
    } else {
        botState.lossesSession++;
        console.log(`🛡️ BALA PERDIDA: -$${Math.abs(profit).toFixed(2)} (Bajo control)`);
    }

    botState.currentContractId = null;
    botState.cooldownRemaining = BOOM_CONFIG.cooldownSeconds;

    const timer = setInterval(() => {
        if (botState.cooldownRemaining > 0) botState.cooldownRemaining--;
        else clearInterval(timer);
    }, 1000);
}

function saveState() {
    try { fs.writeFileSync(STATE_FILE, JSON.stringify(botState)); } catch (e) { }
}
