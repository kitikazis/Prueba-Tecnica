'use strict';

const Hapi = require('@hapi/hapi');
const Joi = require('joi');
const axios = require('axios'); // Cliente HTTP para comunicación MS-MS
const mysql = require('mysql2/promise');
const redis = require('redis'); 
const amqp = require('amqplib'); // Cliente para RabbitMQ

// --- CONFIGURACIÓN DE CONEXIÓN ---
const CLIENTES_DB_CONFIG = {
    host: 'localhost',
    user: 'root', 
    password: '', 
    database: 'seguridaddb', // CORRECCIÓN: Usar la DB de Clientes (clientesDB)
    port: 3306 
};

const SECURITY_MS_URL = 'http://localhost:3001/api/security/validate';
const RABBITMQ_URI = 'amqp://localhost'; 
const REDIS_PORT = 6379; 
const CORREO_QUEUE = 'cola_correos'; 

// Conexiones globales
let dbConnectionClientes;
let redisClient;
let rabbitMqChannel; 

// --- Funciones Auxiliares (omitiendo implementaciones, asumiendo que están completas) ---

const cargarParametrosARedis = async () => {
    // Busca los parámetros en la tabla de MySQL
    const [rows] = await dbConnectionClientes.execute('SELECT nombre_parametro, valor FROM parametros_globales');
    
    for (const row of rows) {
        await redisClient.set(row.nombre_parametro, row.valor);
    }
    console.log('✅ Parámetros Globales cargados a Redis.');
};

const enviarOrdenCorreo = async (clienteData) => {
    await rabbitMqChannel.assertQueue(CORREO_QUEUE, { durable: true });
    rabbitMqChannel.sendToQueue(
        CORREO_QUEUE, 
        Buffer.from(JSON.stringify(clienteData)), 
        { persistent: true } 
    );
    console.log(`✉️ Orden de correo enviada a RabbitMQ para: ${clienteData.nombres}`);
};

// =================================================================
// FUNCIÓN INICIALIZADORA PRINCIPAL
// =================================================================

const init = async () => {
    
    // 1. Conexión a MySQL
    try {
        dbConnectionClientes = await mysql.createConnection(CLIENTES_DB_CONFIG);
        console.log('✅ Conexión a MySQL (Clientes) exitosa.');
    } catch (error) {
        console.error('❌ Error al conectar a MySQL (Clientes):', error.message);
        process.exit(1);
    }
    
    // 2. Conexión a Redis
    try {
        redisClient = redis.createClient({ port: REDIS_PORT, host: 'localhost' });
        redisClient.on('error', (err) => console.error('❌ Error de conexión a Redis:', err));
        await redisClient.connect();
        console.log('✅ Conexión a Redis exitosa.');
        
        await cargarParametrosARedis(); 
    } catch (error) {
        console.error('❌ Error al iniciar Redis:', error);
    }
    
    // 3. Conexión a RabbitMQ
    try {
        const connection = await amqp.connect(RABBITMQ_URI);
        rabbitMqChannel = await connection.createChannel();
        console.log('✅ Conexión a RabbitMQ exitosa.');
    } catch (error) {
        console.error('❌ Error al conectar a RabbitMQ:', error.message);
    }

    // 4. Configuración del Servidor (Puerto 3000)
    const server = Hapi.server({
        port: 3000, 
        host: 'localhost',
        routes: { cors: true } 
    });

    // --- RUTA DE REGISTRO DE CLIENTES (POST /api/clientes) ---
    server.route({
        method: 'POST',
        path: '/api/clientes',
        options: {
            validate: {
                payload: Joi.object({
                    token: Joi.string().length(8).required(),
                    bonoBienvenida: Joi.boolean(),
                    documentoTipo: Joi.string().required(),
                    nroDocumento: Joi.string().required(),
                    nombres: Joi.string().required(),
                    apellidos: Joi.string().required(),
                    fechaNacimiento: Joi.object({
                        anio: Joi.number().min(1900).required(),
                        mes: Joi.number().min(1).max(12).required(),
                        dia: Joi.number().min(1).max(31).required(),
                    }).required()
                })
            }
        },
        handler: async (request, h) => {
            const payload = request.payload;
            const { token, bonoBienvenida, documentoTipo, nroDocumento, nombres, apellidos, fechaNacimiento } = payload;
            
            // A. VALIDAR TOKEN CON MS SEGURIDAD (3001) <--- LÓGICA AGREGADA
            try {
                // Llama al MS Seguridad (3001) para validar el token y marcarlo como usado
                await axios.post(SECURITY_MS_URL, { token }); 
            } catch (error) {
                const status = error.response?.status;
                if (status === 401) {
                    return h.response({ message: 'Error de Seguridad: Token inválido, expirado o ya utilizado.' }).code(401);
                }
                console.error('❌ Error de comunicación con MS Seguridad:', error.message);
                return h.response({ message: 'Error en servicio de validación.' }).code(503);
            }

            // B. REGISTRAR CLIENTE EN MySQL
            let insertId;
            try {
                const fechaNacimientoStr = `${fechaNacimiento.anio}-${String(fechaNacimiento.mes).padStart(2, '0')}-${String(fechaNacimiento.dia).padStart(2, '0')}`;
                
                const insertQuery = `
                    INSERT INTO clientes (token_seguridad, nombres, apellidos, nroDocumento, documentoTipo, bonoBienvenida, fechaNacimiento)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `;
                const [result] = await dbConnectionClientes.execute(insertQuery, [
                    token, nombres, apellidos, nroDocumento, documentoTipo, bonoBienvenida, fechaNacimientoStr
                ]);
                insertId = result.insertId;

            } catch (error) {
                console.error('❌ Error DETALLADO al registrar cliente en MySQL:', error); 
                
                if (error.code === 'ER_DUP_ENTRY') {
                    return h.response({ message: 'Error: El número de documento o token ya está registrado.' }).code(409); 
                }
                
                return h.response({ message: 'Error interno del servidor al registrar.' }).code(500);
            }

            // C. CONSULTA REDIS Y ENVÍO A RABBITMQ <--- LÓGICA AGREGADA
            try {
                // Consulta Redis (Requisito 2.3)
                const sendMailActive = await redisClient.get('habilitar_correo_bienvenida');
                
                if (sendMailActive === 'true' && bonoBienvenida) {
                    // Envía la orden a RabbitMQ (Requisito 2.4)
                    await enviarOrdenCorreo({
                        clienteId: insertId,
                        nombres: nombres,
                        email: `${nombres.replace(/\s/g, '').toLowerCase()}@ejemplo.com`, // Email simulado
                        motivo: 'Bienvenida por registro'
                    });
                } else {
                    console.log('📧 Envío de correo omitido (Parámetro Redis inactivo o cliente no optó).');
                }
            } catch (error) {
                console.warn('⚠️ Alerta: Fallo en la lógica de Redis/RabbitMQ. Cliente guardado.', error.message);
            }

            // Respuesta final
            return h.response({
                message: 'Cliente registrado con éxito (Flujo completo ejecutado).',
                clienteId: insertId
            }).code(201);
        }
    });

    // 5. Inicio del Servidor
    await server.start();
    console.log(`🚀 Microservicio de Clientes corriendo en: ${server.info.uri}`);
};

// Manejo de errores de rechazo no controlado (FUNDAMENTAL)
process.on('unhandledRejection', (err) => {
    console.error('Unhandled Rejection:', err);
    process.exit(1);
});

// EJECUCIÓN: Llama a la función de inicio
init();