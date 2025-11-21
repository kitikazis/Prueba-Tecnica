'use strict';

// Carga variables del .env si se ejecuta localmente (en Docker se inyectan solas)
require('dotenv').config({ path: '../.env' }); 

const Hapi = require('@hapi/hapi');
const Joi = require('joi');
const axios = require('axios'); 
const mysql = require('mysql2/promise');
const redis = require('redis'); 
const amqp = require('amqplib'); 

// --- CONFIGURACIÓN DE CONEXIÓN A BD (Adaptada para Docker) ---
const CLIENTES_DB_CONFIG = {
    host: process.env.MYSQL_HOST || 'ms-mysql', // Lee 'ms-mysql' del .env
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || 'root_secret_password', // Lee la clave segura
    database: 'clientes_db', // El nombre de la base de datos de Clientes
    port: 3306 // Puerto interno de Docker
};

// --- CONFIGURACIÓN DE INFRAESTRUCTURA Y COMUNICACIÓN ---
const SECURITY_MS_URL = process.env.SECURITY_MS_URL || 'http://ms-security:3001/api/security/validate'; // URL interna MS-MS
const RABBITMQ_URI = process.env.RABBITMQ_HOST || 'amqp://guest:guest@ms-rabbitmq:5672'; 
const REDIS_HOST = process.env.REDIS_HOST || 'ms-redis'; 
const REDIS_PORT = process.env.REDIS_PORT || 6379;
const CORREO_QUEUE = 'cola_correos'; 

// Conexiones globales
let dbConnectionClientes;
let redisClient;
let rabbitMqChannel; 

// --- Funciones Auxiliares ---

const cargarParametrosARedis = async () => {
    // Busca los parámetros en la tabla de MySQL
    const [rows] = await dbConnectionClientes.execute('SELECT nombre, valor FROM parametros_globales');
    
    // Almacena en Redis
    for (const row of rows) {
        await redisClient.set(row.nombre, row.valor);
    }
    console.log('✅ Parámetros Globales cargados a Redis.');
};

const enviarOrdenCorreo = async (clienteData) => {
    // Asegura que la cola exista y envía el mensaje
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
        redisClient = redis.createClient({ url: `redis://${REDIS_HOST}:${REDIS_PORT}` });
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

    // 4. Configuración del Servidor (IMPORTANTE: host '0.0.0.0' para Docker)
    const server = Hapi.server({
        port: 3000,  
        host: '0.0.0.0', // Permite que otros contenedores accedan a él
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
            
            // A. VALIDAR TOKEN CON MS SEGURIDAD 
            try {
                // Llama al MS Seguridad usando la URL interna (ms-security)
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

            // C. CONSULTA REDIS Y ENVÍO A RABBITMQ 
            try {
                // Consulta Redis para el parámetro 'habilitar_correo_bienvenida'
                const sendMailActive = await redisClient.get('habilitar_correo_bienvenida');
                
                if (sendMailActive === 'true' && bonoBienvenida) {
                    // Envía la orden a RabbitMQ
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

// Manejo de errores de rechazo no controlado
process.on('unhandledRejection', (err) => {
    console.error('Unhandled Rejection:', err);
    process.exit(1);
});

// EJECUCIÓN: Llama a la función de inicio
init();