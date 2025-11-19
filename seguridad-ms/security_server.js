'use strict';

const Hapi = require('@hapi/hapi');
const Joi = require('joi');
const mysql = require('mysql2/promise'); // Cliente MySQL con soporte para async/await

// --- CONFIGURACIÓN DE CONEXIÓN A MySQL (XAMPP) ---
const DB_CONFIG = {
    host: 'localhost',
    user: 'root', 
    password: '', 
    database: 'seguridaddb', 
    port: 3306 
};

let dbConnection;

// Función para generar un token de 8 dígitos
const generateToken = () => {
    const min = 10000000;
    const max = 99999999;
    return (Math.floor(Math.random() * (max - min + 1)) + min).toString();
};

const init = async () => {
    // 1. Conexión a MySQL
    try {
        dbConnection = await mysql.createConnection(DB_CONFIG);
        console.log('✅ Conexión a MySQL (Seguridad) exitosa.');
    } catch (error) {
        console.error('❌ Error al conectar a MySQL (Seguridad):', error.message);
        process.exit(1);
    }
    
    // 2. Configuración del Servidor (Puerto CORREGIDO a 3001)
    const server = Hapi.server({
        port: 3001, // <--- PUERTO CORREGIDO PARA EL MICROSERVICIO DE SEGURIDAD
        host: 'localhost',
        routes: { cors: true } 
    });

    // --- ENDPOINT 1: GENERAR TOKEN (Registro en MySQL) ---
    server.route({
        method: 'GET',
        path: '/api/security/token',
        handler: async (request, h) => {
            const tokenValue = generateToken();
            const expiraEn = new Date(Date.now() + 30 * 60 * 1000); // 30 minutos

            try {
                const query = 'INSERT INTO tokens (token, expiraEn) VALUES (?, ?)';
                await dbConnection.execute(query, [tokenValue, expiraEn]);

                return h.response({ token: tokenValue }).code(200);
            } catch (error) {
                console.error('Error al generar y guardar token en MySQL:', error);
                return h.response({ message: 'Error interno al generar token.' }).code(500);
            }
        }
    });

    // --- ENDPOINT 2: VALIDAR TOKEN (Usado por el MS Clientes) ---
    server.route({
        method: 'POST',
        path: '/api/security/validate',
        options: {
            validate: {
                payload: Joi.object({
                    token: Joi.string().length(8).required()
                })
            }
        },
        handler: async (request, h) => {
            const { token } = request.payload;
            
            try {
                const selectQuery = 'SELECT id FROM tokens WHERE token = ? AND valido = TRUE AND expiraEn > NOW()';
                const [rows] = await dbConnection.execute(selectQuery, [token]);
                
                if (rows.length === 0) {
                    return h.response({ valido: false, message: 'Token inválido, expirado o ya utilizado.' }).code(401); 
                }
                
                const updateQuery = 'UPDATE tokens SET valido = FALSE WHERE id = ?';
                await dbConnection.execute(updateQuery, [rows[0].id]);

                return h.response({ valido: true, message: 'Token validado con éxito.' }).code(200);

            } catch (error) {
                console.error('Error al validar token en MySQL:', error);
                return h.response({ valido: false, message: 'Error interno del servidor al validar token.' }).code(500);
            }
        }
    });

    // 3. Inicio del Servidor
    await server.start();
    console.log(`🚀 Microservicio de Seguridad corriendo en: ${server.info.uri}`);
};

// Manejo de errores de rechazo no controlado y ejecución
process.on('unhandledRejection', (err) => {
    console.error('Unhandled Rejection:', err);
    process.exit(1);
});

init();