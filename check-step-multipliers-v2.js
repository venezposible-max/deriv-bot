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
        msg.contracts_for.available.forEach(c => {
            if (c.contract_category === 'multipliers') {
                console.log(`Contract: ${c.contract_display}, Mults: ${c.multiplier_range.join(', ')}`);
            }
        });
        ws.close();
    } else if (msg.error) {
        console.error('Error:', msg.error.message);
        ws.close();
    }
});
