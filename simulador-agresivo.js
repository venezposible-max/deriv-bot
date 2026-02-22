/**
 * SIMULADOR "TODO AL BALANCE" (AGRESIVO)
 * ¿Qué pasa si reinvierto el 100% del saldo en cada trade?
 * TP: 10% | SL: 20% | WR: 78.9%
 */

let balance = 10.00;
const WIN_RATE = 0.789;
const TOTAL_TRADES = 10 * 22; // 10 trades al día por 1 mes (22 días)

console.log(`\n🔥 SIMULACIÓN AGRESIVA: REINVERTIR TODO EL SALDO`);
console.log(`==========================================================`);
console.log(`Inicio: $${balance.toFixed(2)} | Cada trade usa el 100% del Saldo`);
console.log(`==========================================================\n`);

for (let i = 1; i <= TOTAL_TRADES; i++) {
    let stake = balance;
    if (stake < 1) {
        console.log(`❌ DÍA TERMINADO: Cuenta quemada (Saldo insuficiente para operar).`);
        balance = 0;
        break;
    }

    const isWin = Math.random() < WIN_RATE;
    if (isWin) {
        balance += (stake * 0.10); // Gana el 10%
    } else {
        balance -= (stake * 0.20); // Pierde el 20%
    }

    if (i % 22 === 0) {
        console.log(`📈 Tras ${i} trades (Aprox ${i / 10} días): $${balance.toFixed(2)}`);
    }
}

console.log(`\n--------------------------------------------------`);
console.log(`🏆 RESULTADO FINAL: $${balance.toFixed(2)}`);
console.log(`Rendimiento: +${(((balance / 10) - 1) * 100).toFixed(0)}%`);
console.log(`--------------------------------------------------\n`);
