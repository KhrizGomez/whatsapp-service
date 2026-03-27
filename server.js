const express = require('express');
const config = require('./config');
const { conectarWhatsApp, enviarMensaje, obtenerEstado, solicitarCodigo } = require('./whatsapp');

const app = express();
app.use(express.json());

// Middleware de autenticación simple
function verificarApiKey(req, res, next) {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey || apiKey !== config.apiKey) {
        return res.status(401).json({ error: 'API Key inválida o no proporcionada' });
    }
    next();
}

// Health check (sin autenticación)
app.get('/api/whatsapp/estado', (req, res) => {
    res.json({
        servicio: 'SGTE WhatsApp Service',
        estado: obtenerEstado(),
        timestamp: new Date().toISOString(),
    });
});

// Solicitar código de vinculación usando el número de config
app.post('/api/whatsapp/solicitar-codigo', verificarApiKey, async (req, res) => {
    try {
        const codigo = await solicitarCodigo(config.miNumero);
        res.json({ exito: true, codigo });
    } catch (error) {
        console.error('Error al solicitar código:', error.message);
        res.status(500).json({ exito: false, error: error.message });
    }
});

// Enviar mensaje individual
app.post('/api/whatsapp/enviar', verificarApiKey, async (req, res) => {
    const { numero, mensaje } = req.body;

    if (!numero || !mensaje) {
        return res.status(400).json({ error: 'Se requieren los campos "numero" y "mensaje"' });
    }

    try {
        const resultado = await enviarMensaje(numero, mensaje);
        res.json({
            exito: true,
            mensaje: 'Mensaje enviado correctamente',
            detalles: { numero, messageId: resultado?.key?.id || null },
        });
    } catch (error) {
        console.error('Error al enviar mensaje:', error.message);
        res.status(500).json({
            exito: false,
            error: error.message,
        });
    }
});

// Enviar mensaje a múltiples destinatarios
app.post('/api/whatsapp/enviar-masivo', verificarApiKey, async (req, res) => {
    const { destinatarios } = req.body;

    if (!destinatarios || !Array.isArray(destinatarios) || destinatarios.length === 0) {
        return res.status(400).json({ error: 'Se requiere un array "destinatarios" con {numero, mensaje}' });
    }

    const resultados = [];
    for (const dest of destinatarios) {
        try {
            await enviarMensaje(dest.numero, dest.mensaje);
            resultados.push({ numero: dest.numero, exito: true });
        } catch (error) {
            resultados.push({ numero: dest.numero, exito: false, error: error.message });
        }
    }

    res.json({ total: destinatarios.length, resultados });
});

// Iniciar servicio
app.listen(config.puerto, () => {
    console.log(`Servidor WhatsApp API escuchando en http://localhost:${config.puerto}`);
    console.log(`Health check: GET http://localhost:${config.puerto}/api/whatsapp/estado`);
});

// Intentar conectar WhatsApp en segundo plano
conectarWhatsApp()
    .then(() => console.log('WhatsApp conectado y listo.'))
    .catch((err) => console.log('WhatsApp no conectado:', err.message, '— Usa la UI para vincular.'));
