const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = 3000;

app.get('/pruebas', (req, res) => {
    res.json({
        status: 'ok',
        service: 'apiGateway'
    });
});

app.use('/api/sports', createProxyMiddleware({
    target: 'http://127.0.0.1:8001',
    changeOrigin: true
}));

app.use('/api/aiTraining', createProxyMiddleware({
    target: 'http://127.0.0.1:8002',
    changeOrigin: true
}));

app.use('/api/communication', createProxyMiddleware({
    target: 'http://127.0.0.1:3001',
    changeOrigin: true
}));

app.listen(PORT, () => {
    console.log(`API Gateway iniciado en http://localhost:${PORT}`);
});