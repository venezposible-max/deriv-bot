/**
 * SIMULADOR DE 1 DÍA - ESTRATEGIA TODO AL BALANCE (AGRESIVO)
 * ¿Qué pasa si empezamos con $10 y reinvertimos el 100% en cada trade?
 * TP: 10% ($1 por cada $10) | SL: 20% ($2 por cada $10)
 * Win Rate: 78.9% | Trades: 10
 */

let balance = 10.00;
const INITIAL_BALANCE = 10.00;
const WIN_RATE = 0.789;
const TOTAL_TRADES = 10;

console.log(`\n🔥 SIMULACIÓN DE 1 DÍA (10 TRADES) - TODO AL BALANCE`);
console.log(`==========================================================`);
console.log(`Saldo Inicial: $${INITIAL_BALANCE.toFixed(2)}`);
console.log(`Estrategia: PM-40 Pro | Riesgo: 100% en cada disparo`);
console.log(`==========================================================\n`);

for (let i = 1; i <= TOTAL_TRADES; i++) {
    let stake = balance;
    const isWin = Math.random() < WIN_RATE;
    let result = 0;

    if (isWin) {
        result = stake * 0.10; // Gana el 10% (TP de $1 sobre $10)
        balance += result;
        console.log(`Trade ${i.toString().padEnd(2)}: ✅ GANADO  | Balance: $${balance.toFixed(2).padEnd(8)} (Entrada: $${stake.toFixed(2)})`);
    } else {
        result = -(stake * 0.20); // Pierde el 20% (SL de $2 sobre $10)
        balance += result;
        console.log(`Trade ${i.toString().padEnd(2)}: ❌ PERDIDO | Balance: $${balance.toFixed(2).padEnd(8)} (Entrada: $${stake.toFixed(2)})`);
    }

    if (balance < 1) {
        console.log(`\n💀 CUENTA QUEMADA: Saldo por debajo del mínimo de operación.`);
        break;
    }
}

console.log(`\n--------------------------------------------------`);
console.log(`🏆 RESULTADO TRAS EL PRIMER DÍA:`);
console.log(`Saldo Final: $${balance.toFixed(2)}`);
console.log(`Ganancia Neta: $${(balance - INITIAL_BALANCE).toFixed(2)}`);
console.log(`Porcentaje de Crecimiento: +${(((balance / INITIAL_BALANCE) - 1) * 100).toFixed(2)}%`);
console.log(`--------------------------------------------------\n`);
