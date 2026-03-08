const WebSocket = require('ws');
const ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=1089');

ws.on('open', () => {
    ws.send(JSON.stringify({ active_symbols: 'brief', landing_company: 'svg' }));
});

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.active_symbols) {
        msg.active_symbols.forEach(s => {
            if (s.display_name.toLowerCase().includes('step')) {
                console.log(`Symbol: ${s.symbol}, Name: ${s.display_name}`);
            }
        });
        ws.close();
    }
});
