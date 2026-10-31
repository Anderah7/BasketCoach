const express = require('express');
const pruebasRouter = require('./routes/pruebas');

const app = express();
const PORT = 3000;

app.use(pruebasRouter);

app.listen(PORT, () => {
    console.log(`API Gateway iniciado en http://localhost:${PORT}`);
});
