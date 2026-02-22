/**
 * SIMULADOR PRO 90 DÍAS (3 MESES) - INTERÉS COMPUESTO
 * Estrategia: Oro PM-40 Pro
 */

const INITIAL_BALANCE = 10.00;
const MONTHS = 3;
const TRADING_DAYS_PER_MONTH = 22; // Sin fines de semana
const TOTAL_DAYS = MONTHS * TRADING_DAYS_PER_MONTH;
const WIN_RATE = 0.789;
const TRADES_PER_DAY = 10;
const RISK_PER_TRADE_PCT = 0.10; // Stake = 10% del Balance
const TP_PCT = 0.10; // Ganamos 10% del Stake
const SL_PCT = 0.20; // Perdemos 20% del Stake
const DAILY_LIMIT_PCT = 0.05; // 5% Drawdown diario

let balance = INITIAL_BALANCE;

console.log(`\n💎 PROYECCIÓN TRIMESTRAL (90 DÍAS): ORO PM-40 PRO`);
console.log(`==========================================================`);
console.log(`Inversión Inicial: $${INITIAL_BALANCE.toFixed(2)}`);
console.log(`Días de Operación: ${TOTAL_DAYS} (Lunes a Viernes)`);
console.log(`==========================================================\n`);

for (let month = 1; month <= MONTHS; month++) {
    let monthStartBalance = balance;

    for (let day = 1; day <= TRADING_DAYS_PER_MONTH; day++) {
        let dayStartBalance = balance;
        let dayPnL = 0;

        for (let t = 0; t < TRADES_PER_DAY; t++) {
            let currentStake = balance * RISK_PER_TRADE_PCT;
            if (currentStake < 1) currentStake = 1; // Mínimo Deriv

            const isWin = Math.random() < WIN_RATE;
            let result = isWin ? (currentStake * TP_PCT) : -(currentStake * SL_PCT);

            dayPnL += result;
            balance += result;

            // Freno de Drawdown Diario
            if (dayPnL <= -(dayStartBalance * DAILY_LIMIT_PCT)) break;
        }
    }

    let monthGain = ((balance / monthStartBalance) - 1) * 100;
    console.log(`📅 MES ${month}:`);
    console.log(`   Saldo Final: $${balance.toFixed(2)}`);
    console.log(`   Rendimiento Mensual: +${monthGain.toFixed(1)}%`);
    console.log(`   -----------------------------------`);
}

console.log(`\n🏆 RESULTADO FINAL TRAS 3 MESES:`);
console.log(`Saldo Final: $${balance.toFixed(2)}`);
console.log(`Multiplicador: ${(balance / INITIAL_BALANCE).toFixed(1)}x`);
console.log(`Retorno Total: +${(((balance / INITIAL_BALANCE) - 1) * 100).toFixed(2)}%`);
console.log(`==========================================================\n`);
