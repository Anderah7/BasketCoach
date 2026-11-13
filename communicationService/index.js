const Fastify = require('fastify');
const cors = require('@fastify/cors');
const routes = require('./routes/pruebas');

const app = Fastify();
const PORT = 3001;
const origins = (process.env.CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);

app.register(cors, {
    origin: origins,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
});
app.register(routes);

app.listen({ port: PORT, host: '0.0.0.0' })
    .then(() => console.log(`Servidor iniciado en http://localhost:${PORT}`))
    .catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
