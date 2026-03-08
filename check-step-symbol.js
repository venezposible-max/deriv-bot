const WebSocket = require('ws');
const ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=1089');

ws.on('open', () => {
    ws.send(JSON.stringify({ active_symbols: 'brief', product_type: 'basic' }));
});

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.active_symbols) {
        const step = msg.active_symbols.find(s => s.display_name.toLowerCase().includes('step'));
        console.log('STEP INDEX SYMBOL:', step ? step.symbol : 'NOT FOUND');
        ws.close();
    }
});
