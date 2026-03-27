const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom");
const pino = require("pino");
const config = require("./config");
const fs = require('fs');

let sock = null;
let estadoConexion = 'desconectado';

async function conectarWhatsApp() {
    return new Promise(async (resolve, reject) => {
        try {
            const { state, saveCreds } = await useMultiFileAuthState(config.sesionCarpeta);
            const { version } = await fetchLatestBaileysVersion();

            sock = makeWASocket({
                version,
                auth: state,
                printQRInTerminal: false,
                logger: pino({ level: "silent" }),
            });

            // Vinculación si no hay sesión
            if (!sock.authState.creds.registered) {
                console.log(`No se encontró sesión. Solicitando código para: ${config.miNumero}...`);
                setTimeout(async () => {
                    try {
                        const code = await sock.requestPairingCode(config.miNumero);
                        console.log(`\n=========================================`);
                        console.log(`>>> CÓDIGO DE VINCULACIÓN: ${code} <<<`);
                        console.log(`=========================================\n`);
                        console.log("Ingresa este código en tu celular para vincular.");
                    } catch (err) {
                        console.error("Error al pedir código de vinculación:", err.message);
                    }
                }, 3000);
            }

            sock.ev.on('creds.update', saveCreds);

            sock.ev.on('connection.update', (update) => {
                const { connection, lastDisconnect } = update;

                if (connection === 'close') {
                    estadoConexion = 'desconectado';
                    const shouldReconnect = (lastDisconnect?.error instanceof Boom)
                        ? lastDisconnect.error.output?.statusCode !== DisconnectReason.loggedOut
                        : true;

                    if (shouldReconnect) {
                        console.log('Reconectando WhatsApp...');
                        setTimeout(() => conectarWhatsApp(), 3000);
                    } else {
                        console.error("Sesión cerrada. Se requiere nueva vinculación.");
                        reject(new Error('loggedOut'));
                    }
                } else if (connection === 'open') {
                    estadoConexion = 'conectado';
                    console.log('WhatsApp conectado exitosamente.');
                    resolve(sock);
                }
            });
        } catch (error) {
            estadoConexion = 'error';
            reject(error);
        }
    });
}

async function solicitarCodigo(numeroLimpio) {
    // Eliminar sesión antigua si existe
    if (fs.existsSync(config.sesionCarpeta)) {
        fs.rmSync(config.sesionCarpeta, { recursive: true, force: true });
    }

    // Desconectar socket existente si lo hay
    if (sock) {
        try { sock.ev.removeAllListeners(); sock.ws.close(); } catch (_) {}
        sock = null;
    }
    estadoConexion = 'desconectado';

    const { state, saveCreds } = await useMultiFileAuthState(config.sesionCarpeta);
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: "silent" }),
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            estadoConexion = 'desconectado';
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            // Reconectar durante el flujo de vinculación (NO si fue loggedOut definitivo)
            if (statusCode !== DisconnectReason.loggedOut) {
                console.log('Reconectando durante vinculación...');
                const { state: newState, saveCreds: newSaveCreds } = await useMultiFileAuthState(config.sesionCarpeta);
                const { version: newVersion } = await fetchLatestBaileysVersion();
                sock = makeWASocket({
                    version: newVersion,
                    auth: newState,
                    printQRInTerminal: false,
                    logger: pino({ level: "silent" }),
                });
                sock.ev.on('creds.update', newSaveCreds);
                sock.ev.on('connection.update', (u) => {
                    if (u.connection === 'open') {
                        estadoConexion = 'conectado';
                        console.log('WhatsApp conectado exitosamente (vinculación completada).');
                    } else if (u.connection === 'close') {
                        estadoConexion = 'desconectado';
                    }
                });
            }
        } else if (connection === 'open') {
            estadoConexion = 'conectado';
            console.log('WhatsApp conectado exitosamente (nueva sesión).');
        }
    });

    // Pedir código de vinculación después de un breve delay
    return new Promise((resolve, reject) => {
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(numeroLimpio);
                console.log(`>>> CÓDIGO DE VINCULACIÓN SOLICITADO VÍA API: ${code} <<<`);
                resolve(code);
            } catch (err) {
                reject(new Error("Error al pedir código de vinculación: " + err.message));
            }
        }, 3000);
    });
}

async function enviarMensaje(numero, texto) {
    if (!sock || estadoConexion !== 'conectado') {
        throw new Error("WhatsApp no está conectado.");
    }
    const jid = numero.includes('@s.whatsapp.net') ? numero : `${numero}${config.sufijoWhatsApp}`;
    const resultado = await sock.sendMessage(jid, { text: texto });
    return resultado;
}

function obtenerEstado() {
    return estadoConexion;
}

module.exports = { conectarWhatsApp, enviarMensaje, obtenerEstado, solicitarCodigo };
