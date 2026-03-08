const WebSocket = require('ws');
const ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=1089');

ws.on('open', () => {
    ws.send(JSON.stringify({
        contracts_for: 'R_100'
    }));
});

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.contracts_for) {
        msg.contracts_for.available.filter(c => c.contract_category === 'multipliers').forEach(c => {
            console.log(`R_100 Mults: ${c.multiplier_range.join(', ')}`);
        });
        ws.close();
    }
});
