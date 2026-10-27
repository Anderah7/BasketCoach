const express = require('express');
const pruebasRouter = require('./routes/pruebas');

const app = express();
const PORT = 3001;

app.use(express.json());

app.use(pruebasRouter);

app.listen(PORT, () => {
    console.log(`Servidor iniciado en http://localhost:${PORT}`);
});