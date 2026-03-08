const WebSocket = require('ws');
const ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=1089');

ws.on('open', () => {
    ws.send(JSON.stringify({
        contracts_for: 'stpRNG'
    }));
});

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.contracts_for) {
        const multipliers = msg.contracts_for.available.filter(c => c.contract_category === 'multipliers');
        multipliers.forEach(m => {
            console.log(`Contract: ${m.contract_display}, Multipliers: ${m.multiplier_range.join(', ')}`);
        });
        ws.close();
    } else if (msg.error) {
        console.error('Error:', msg.error.message);
        ws.close();
    }
});
