const WebSocket = require('ws');
const express = require('express');
const cors = require('cors');

// ==========================================
// CONFIGURACIÓN DEL BOT - ESTRATEGIA GANADORA
// ==========================================
const APP_ID = 1089;
const SYMBOL = 'R_100';
const MULTIPLIER = 40;
const STAKE_AMOUNT = 3;
const TP_PERCENT = 0.03; // Take Profit: 3% del stake (~$0.30 para $10)
// Sin Stop Loss - Liquidación total del stake
const MOMENTUM_TICKS = 5;

// Auth y Variables
const API_TOKEN = process.env.DERIV_TOKEN;
const WEB_PASSWORD = process.env.WEB_PASSWORD || "colina123"; // Clave secreta para la web (Cámbiala en Railway)

if (!API_TOKEN) {
    console.error('❌ ERROR: No se encontró el token de Deriv. Define DERIV_TOKEN en Railway.');
}

// ESTADOS GLOBALES DEL BOT
let botState = {
    isRunning: true, // El "Switch" principal. Iniciamos encendidos por defecto
    isConnectedToDeriv: false,
    balance: 0,
    totalTradesSession: 0,
    winsSession: 0,
    lossesSession: 0,
    pnlSession: 0,
    currentContractId: null,
    lastTradeTime: null
};

let ws;
let isBuying = false;
let cooldownTime = 0;
let tickHistory = [];

console.log('🚀 Iniciando Servidor 24/7 (Express + WS)...');

// ==========================================
// SERVIDOR WEB (CONTROL REMOTO PARA VERCEL)
// ==========================================
const app = express();
app.use(cors());
app.use(express.json());

// Endpoint 1: Ver estado del Bot (La web de Vercel llamará a esto para actualizar la UI)
app.get('/api/status', (req, res) => {
    res.json({
        success: true,
        data: botState
    });
});

// Endpoint 2: Control Remoto (Pausar / Reanudar)
app.post('/api/control', (req, res) => {
    const { action, password } = req.body;

    // Medida de seguridad básica (La misma clave debe estar configurada en la App Web)
    if (password !== WEB_PASSWORD) {
        return res.status(401).json({ success: false, error: 'Contraseña incorrecta' });
    }

    if (action === 'START') {
        botState.isRunning = true;
        console.log('▶️ COMANDO REMOTO: Bot Reanudado.');
        return res.json({ success: true, message: 'Bot Activado', isRunning: true });
    }

    if (action === 'STOP') {
        botState.isRunning = false;
        console.log('⏸️ COMANDO REMOTO: Bot Pausado.');
        // Nota: Solo se pausa la captura de nuevas operaciones. Las operaciones abiertas por Deriv siguen su curso hasta TP/SL.
        return res.json({ success: true, message: 'Bot Pausado', isRunning: false });
    }

    res.status(400).json({ success: false, error: 'Acción inválida' });
});

// Arrancar servidor Express (Railway usará el puerto dinámico Process.env.PORT)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🌍 Módulo Web levantado en el puerto ${PORT}`);
});


// ==========================================
// NÚCLEO DEL BOT (WEBSOCKET DERIV)
// ==========================================
function connectDeriv() {
    if (!API_TOKEN) return;

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
            isBuying = false;
            return;
        }

        // Auth Exitosa
        if (msg.msg_type === 'authorize') {
            botState.isConnectedToDeriv = true;
            botState.balance = msg.authorize.balance;
            console.log(`✅ Autorizado. Saldo: $${botState.balance}`);
            ws.send(JSON.stringify({ ticks: SYMBOL, subscribe: 1 }));
        }

        // Ticks en Tiempo Real (Procesador de Estrategia)
        if (msg.msg_type === 'tick') {
            const quote = parseFloat(msg.tick.quote);
            tickHistory.push(quote);
            if (tickHistory.length > 20) tickHistory.shift(); // Max memoria 20 ticks

            // ¿EL SWITCH ESTÁ ENCENDIDO? Solo operamos si botState.isRunning === true
            if (botState.isRunning && botState.isConnectedToDeriv && !botState.currentContractId && cooldownTime === 0 && !isBuying && tickHistory.length >= MOMENTUM_TICKS) {
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

        // Catch: Compra generada exitosa
        if (msg.msg_type === 'buy') {
            isBuying = false;
            botState.currentContractId = msg.buy.contract_id;
            botState.balance = msg.buy.balance_after; // Actualizamos saldo
            botState.lastTradeTime = new Date().toISOString();
            console.log(`🛒 Trade Abierto ID: ${botState.currentContractId}`);

            // Queremos saber cuándo cierra para sumar el PnL
            ws.send(JSON.stringify({ proposal_open_contract: 1, contract_id: botState.currentContractId, subscribe: 1 }));
        }

        // Catch: Rastreo del Contrato Activo (Saber cuándo cerró por TP/SL)
        if (msg.msg_type === 'proposal_open_contract') {
            const contract = msg.proposal_open_contract;
            if (contract.is_sold) {
                const profit = parseFloat(contract.profit);
                const isWin = profit > 0;

                console.log(`\n🏁 CONTRATO CERRADO: ${isWin ? '🟢 WIN' : '🔴 LOSS'} -> $${profit.toFixed(2)}`);

                // Actualizar métricas del servidor
                botState.totalTradesSession++;
                botState.pnlSession += profit;
                if (isWin) botState.winsSession++; else botState.lossesSession++;

                // Limpieza post-trade
                botState.currentContractId = null;
                isBuying = false;

                // Cooldown: 15 segs
                cooldownTime = 15;
                console.log(`⏳ Enfriamiento antes del próximo análisis: 15 segs...`);
                const timer = setInterval(() => {
                    cooldownTime--;
                    if (cooldownTime <= 0) {
                        clearInterval(timer);
                        console.log('👀 Radar encendido de nuevo. Buscando señales...');
                        tickHistory = []; // Borramos historial para que la próxima línea Momentum sea 100% fresca
                    }
                }, 1000);

                // Desuscribir el streaming del contrato vendido
                if (contract.id) ws.send(JSON.stringify({ forget: contract.id }));
            }
        }
    });

    ws.on('close', () => {
        console.log('🔌 WebSocket cerrado por Deriv. Reconectando...');
        botState.isConnectedToDeriv = false;
        botState.currentContractId = null;
        isBuying = false;
        setTimeout(connectDeriv, 5000);
    });

    ws.on('error', () => ws.close());
}

// Función que dispara la munición
function executeTrade(type) {
    if (isBuying) return;
    isBuying = true;
    const safeAmt = Math.max(1, STAKE_AMOUNT);

    console.log(`🚀 [SEÑAL ENCONTRADA] Disparando: ${type} | Stake: $${safeAmt} | x${MULTIPLIER}`);
    ws.send(JSON.stringify({
        buy: 1, price: safeAmt,
        parameters: {
            amount: safeAmt, basis: "stake", contract_type: type, currency: "USD",
            multiplier: MULTIPLIER, symbol: SYMBOL,
            limit_order: {
                take_profit: parseFloat(Math.max(0.10, safeAmt * TP_PERCENT).toFixed(2))
            }
        }
    }));

    // Timeout antierrores
    setTimeout(() => { if (isBuying) isBuying = false; }, 5000);
}

// Arranca el motor
connectDeriv();
