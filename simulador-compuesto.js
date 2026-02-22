/**
 * SIMULADOR DE INTERÉS COMPUESTO - ESTRATEGIA ORO PM-40 PRO
 * Basado en el rendimiento real del backtest (78.9% Win Rate)
 */

const INITIAL_BALANCE = 10.00;
const DAYS = 30;
const WIN_RATE = 0.789;
const TRADES_PER_DAY = 10;
const RISK_PER_TRADE = 0.10; // Arriesgamos el 10% del balance como STAKE
const TP_MULT = 0.10; // Ganamos el 10% del STAKE (TP $1 sobre $10) -> Esto es un error en mi lógica previa.
// RECALCULO: Si el stake es $10, ganamos $1 (10% del stake). Si el stake es $100, ganamos $10 (10% del stake).
const SL_MULT = 0.20; // Perdemos el 20% del STAKE (SL $2 sobre $10)
const DAILY_LOSS_LIMIT = 0.05; // 5% de Drawdown diario

let balance = INITIAL_BALANCE;
let history = [];

console.log(`\n📈 SIMULACIÓN PRO: INTERÉS COMPUESTO (30 DÍAS)`);
console.log(`==========================================================`);
console.log(`Capital Inicial: $${INITIAL_BALANCE.toFixed(2)}`);
console.log(`Estrategia: PM-40 OK (Win Rate 78.9%)`);
console.log(`Gestión: Stake Dinámico (10% del Balance)`);
console.log(`==========================================================\n`);

for (let day = 1; day <= DAYS; day++) {
    let dayStartBalance = balance;
    let dayPnL = 0;
    let wins = 0;
    let losses = 0;
    let tradesToday = 0;

    // Solo operamos 5 días a la semana (Mercado de Oro)
    const isWeekend = (day % 7 === 6 || day % 7 === 0);

    if (!isWeekend) {
        for (let t = 0; t < TRADES_PER_DAY; t++) {
            let currentStake = balance * 0.10; // Stake dinámico
            if (currentStake < 1) currentStake = 1; // Mínimo Deriv

            const isWin = Math.random() < WIN_RATE;
            let result = 0;

            if (isWin) {
                result = currentStake * 0.10; // TP de $1.00 sobre $10
                wins++;
            } else {
                result = -(currentStake * 0.20); // SL de $2.00 sobre $10
                losses++;
            }

            dayPnL += result;
            balance += result;
            tradesToday++;

            // Protección de Drawdown Diario
            if (dayPnL <= -(dayStartBalance * DAILY_LOSS_LIMIT)) {
                // console.log(`   [Día ${day}] Drawdown alcanzado. Cerrando sesión.`);
                break;
            }
        }
    }

    if (day % 5 === 0 || day === 1 || day === DAYS) {
        console.log(`📅 Día ${day.toString().padEnd(2)} | Saldo: $${balance.toFixed(2).padEnd(8)} | Ganancia: +${(((balance / INITIAL_BALANCE) - 1) * 100).toFixed(0)}%`);
    }
}

console.log(`\n--------------------------------------------------`);
console.log(`🏆 RESULTADO TRAS 30 DÍAS:`);
console.log(`Saldo Final: $${balance.toFixed(2)}`);
console.log(`Multiplicador total: ${(balance / INITIAL_BALANCE).toFixed(1)}x`);
console.log(`Rendimiento Neto: +${(((balance / INITIAL_BALANCE) - 1) * 100).toFixed(2)}%`);
console.log(`--------------------------------------------------`);
console.log(`Nota: Este cálculo asume que mantienes la disciplina pro\ny reinviertes el 10% del saldo en cada trade.`);
