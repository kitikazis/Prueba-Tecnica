'use strict';

// En Docker las variables se inyectan solas, pero dejamos esto por si lo corres local
require('dotenv').config({ path: '../.env' }); 

const Hapi = require('@hapi/hapi');
const Joi = require('joi');
const mysql = require('mysql2/promise');

// --- CONFIGURACIÓN DE CONEXIÓN A BD (Adaptada para Docker) ---
const DB_CONFIG = {
    host: process.env.DB_HOST || 'ms-mysql',  // Nombre del servicio en docker-compose
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || 'root_secret_password', // ¡Contraseña correcta!
    database: 'seguridad_dsb', 
    port: 3306 // Dentro de la red Docker siempre es 3306
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
        // Intentamos reconectar o salir si es crítico.
        process.exit(1);
    }
    
    // 2. Configuración del Servidor
    const server = Hapi.server({
        port: 3001, 
        host: '0.0.0.0', // IMPORTANTE: '0.0.0.0' permite conexiones desde fuera del contenedor
        routes: { cors: true } 
    });

    // --- ENDPOINT 1: GENERAR TOKEN (GET) ---
    server.route({
        method: 'GET',
        path: '/api/security/token',
        handler: async (request, h) => {
            const tokenValue = generateToken();
            // Expira en 30 minutos
            const expiraEn = new Date(Date.now() + 30 * 60 * 1000); 

            try {
                // Insertamos asumiendo que la tabla tiene 'valido' por defecto en TRUE
                const query = 'INSERT INTO tokens (token, expiraEn) VALUES (?, ?)';
                await dbConnection.execute(query, [tokenValue, expiraEn]);

                console.log(`Token generado: ${tokenValue}`);
                return h.response({ token: tokenValue }).code(200);
            } catch (error) {
                console.error('Error al guardar token:', error);
                return h.response({ message: 'Error interno al generar token.' }).code(500);
            }
        }
    });

    // --- ENDPOINT 2: VALIDAR TOKEN (POST) ---
    // Este es el endpoint que llama tu microservicio de Clientes
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
                // Busca token que sea válido y no haya expirado
                const selectQuery = 'SELECT id FROM tokens WHERE token = ? AND valido = TRUE AND expiraEn > NOW()';
                const [rows] = await dbConnection.execute(selectQuery, [token]);
                
                if (rows.length === 0) {
                    return h.response({ valido: false, message: 'Token inválido o expirado.' }).code(401); 
                }
                
                // "Quemamos" el token para que no se use dos veces
                const updateQuery = 'UPDATE tokens SET valido = FALSE WHERE id = ?';
                await dbConnection.execute(updateQuery, [rows[0].id]);

                console.log(`Token validado y quemado: ${token}`);
                return h.response({ valido: true, message: 'Token validado con éxito.' }).code(200);

            } catch (error) {
                console.error('Error al validar token:', error);
                return h.response({ valido: false, message: 'Error de servidor.' }).code(500);
            }
        }
    });

    // 3. Inicio del Servidor
    await server.start();
    console.log(`🚀 Microservicio de Seguridad corriendo en: ${server.info.uri}`);
};

process.on('unhandledRejection', (err) => {
    console.error('Unhandled Rejection:', err);
    process.exit(1);
});

init();