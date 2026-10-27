const express = require('express');

const router = express.Router();

router.get('/pruebas', (req, res) => {
    res.json({
        status: 'ok',
        service: 'communicationService'
    });
});

module.exports = router;