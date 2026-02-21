const WebSocket = require('ws');

// ==========================================
// CONFIGURACIÓN DEL BOT - ESTRATEGIA GANADORA
// ==========================================
const APP_ID = 1089;
const SYMBOL = 'R_100';
const MULTIPLIER = 40;
const STAKE_AMOUNT = 3;
const TP_PERCENT = 0.20;
const SL_PERCENT = 0.10;
const MOMENTUM_TICKS = 5;

// Este token se leerá desde las Variables de Entorno de Railway
const API_TOKEN = process.env.DERIV_TOKEN;

if (!API_TOKEN) {
    console.error('❌ ERROR: No se encontró el token de Deriv. Define DERIV_TOKEN en Railway.');
    process.exit(1);
}

let ws;
let isConnected = false;
let isBuying = false;
let cooldownTime = 0;
let contractId = null;
let tickHistory = [];

console.log('🚀 Iniciando Bot Deriv 24/7 (Railway)...');
console.log(`📈 Estrategia: Momentum Reversal ${MOMENTUM_TICKS} - ${SYMBOL} x${MULTIPLIER}`);

function connect() {
    ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

    ws.on('open', () => {
        console.log('🌐 Conectado a Deriv. Autenticando...');
        ws.send(JSON.stringify({ authorize: API_TOKEN }));
    });

    ws.on('message', (data) => {
        const msg = JSON.parse(data);

        // Errores
        if (msg.error) {
            console.error(`⚠️ Error: ${msg.error.message}`);
            if (msg.error.code === 'InvalidToken') process.exit(1);
            isBuying = false;
            return;
        }

        // Auth
        if (msg.msg_type === 'authorize') {
            isConnected = true;
            console.log(`✅ Autorizado. Saldo: $${msg.authorize.balance}`);
            ws.send(JSON.stringify({ ticks: SYMBOL, subscribe: 1 }));
        }

        // Ticks
        if (msg.msg_type === 'tick') {
            const quote = parseFloat(msg.tick.quote);
            tickHistory.push(quote);
            if (tickHistory.length > 20) tickHistory.shift();

            if (isConnected && !contractId && cooldownTime === 0 && !isBuying && tickHistory.length >= MOMENTUM_TICKS) {
                const lastTicks = tickHistory.slice(-MOMENTUM_TICKS);
                const allDown = lastTicks.every((v, i) => i === 0 || v < lastTicks[i - 1]);
                const allUp = lastTicks.every((v, i) => i === 0 || v > lastTicks[i - 1]);

                let direction = null;
                if (allDown) direction = 'MULTUP';
                if (allUp) direction = 'MULTDOWN';

                if (direction) {
                    executeTrade(direction);
                }
            }
        }

        // Compra generada
        if (msg.msg_type === 'buy') {
            isBuying = false;
            contractId = msg.buy.contract_id;
            console.log(`🛒 Trade Abierto ID: ${contractId}`);
            ws.send(JSON.stringify({ proposal_open_contract: 1, contract_id: contractId, subscribe: 1 }));
        }

        // Monitoreo del Trade
        if (msg.msg_type === 'proposal_open_contract') {
            const contract = msg.proposal_open_contract;
            if (contract.is_sold) {
                const profit = parseFloat(contract.profit);
                console.log(`\n🏁 CONTRATO CERRADO: ${profit > 0 ? '🟢 GANANCIA' : '🔴 PÉRDIDA'} -> $${profit.toFixed(2)}`);

                contractId = null;
                isBuying = false;
                cooldownTime = 15;
                console.log(`⏳ Enfriamiento: 15 segs...`);

                const timer = setInterval(() => {
                    cooldownTime--;
                    if (cooldownTime <= 0) {
                        clearInterval(timer);
                        console.log('👀 Buscando señales...');
                        tickHistory = [];
                    }
                }, 1000);

                if (contract.id) ws.send(JSON.stringify({ forget: contract.id }));
            }
        }
    });

    ws.on('close', () => {
        console.log('🔌 Desconectado. Reconectando...');
        isConnected = false; contractId = null; isBuying = false;
        setTimeout(connect, 5000);
    });

    ws.on('error', () => ws.close());
}

function executeTrade(type) {
    if (isBuying) return;
    isBuying = true;
    const safeAmt = Math.max(1, STAKE_AMOUNT);

    console.log(`🚀 Ejecutando: ${type} | Stake: $${safeAmt} | x${MULTIPLIER}`);
    ws.send(JSON.stringify({
        buy: 1, price: safeAmt,
        parameters: {
            amount: safeAmt, basis: "stake", contract_type: type, currency: "USD",
            multiplier: MULTIPLIER, symbol: SYMBOL,
            limit_order: {
                stop_loss: parseFloat(Math.max(0.01, safeAmt * SL_PERCENT).toFixed(2)),
                take_profit: parseFloat(Math.max(0.02, safeAmt * TP_PERCENT).toFixed(2))
            }
        }
    }));
    setTimeout(() => { if (isBuying) isBuying = false; }, 5000);
}

connect();
setInterval(() => console.log(`[${new Date().toISOString()}] Bot activo 24/7...`), 1000 * 60 * 60);
