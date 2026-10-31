const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');

const router = express.Router();

router.get('/pruebas', (req, res) => {
    res.json({
        status: 'ok',
        service: 'apiGateway'
    });
});

router.use('/api/sports', createProxyMiddleware({
    target: 'http://127.0.0.1:8001',
    changeOrigin: true
}));

router.use('/api/ai', createProxyMiddleware({
    target: 'http://127.0.0.1:8002',
    changeOrigin: true
}));

router.use('/api/communication', createProxyMiddleware({
    target: 'http://127.0.0.1:3001',
    changeOrigin: true
}));

module.exports = router;
