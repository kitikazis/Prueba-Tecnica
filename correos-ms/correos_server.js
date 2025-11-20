'use strict';

require('dotenv').config({ path: '../.env' }); // Carga variables si lo corres local
const Hapi = require('@hapi/hapi');
const mysql = require('mysql2/promise');
const amqp = require('amqplib'); 

// --- CONFIGURACIÓN DE CONEXIÓN MYSQL (Adaptada para Docker) ---
const CORREOS_DB_CONFIG = {
    host: process.env.MYSQL_HOST || 'ms-mysql',
    user: process.env.MYSQL_USER || 'root', 
    password: process.env.MYSQL_PASSWORD || 'root_secret_password', 
    database: 'correosDB',
    port: 3306 
};

// --- CONFIGURACIÓN RABBITMQ ---
const RABBITMQ_URI = process.env.RABBITMQ_HOST || 'amqp://guest:guest@ms-rabbitmq:5672';
const CORREO_QUEUE = 'cola_correos';

let dbConnectionCorreos;
let rabbitMqChannel; // Declaración global para el canal

/**
 * Función de reintento para conectar a RabbitMQ
 */
const connectRabbitMQ = async (maxRetries = 5, delay = 5000) => {
    for (let i = 0; i < maxRetries; i++) {
        try {
            console.log(`🔌 Intento ${i + 1}/${maxRetries}: Conectando a RabbitMQ...`);
            const connection = await amqp.connect(RABBITMQ_URI); 
            const channel = await connection.createChannel();
            console.log('✅ Conexión a RabbitMQ exitosa.');
            return channel;
        } catch (error) {
            if (i === maxRetries - 1) {
                // Si es el último intento, lanza el error fatal
                throw new Error(`Fallo de conexión a RabbitMQ tras ${maxRetries} intentos.`);
            } 
            console.log(`❌ Falló la conexión a RabbitMQ. Reintentando en ${delay / 1000}s...`);
            await new Promise(resolve => setTimeout(resolve, delay)); // Espera 5 segundos
        }
    }
};


/**
 * Función que inicia el consumidor de RabbitMQ
 */
const startConsumer = async (channel) => {
    await channel.assertQueue(CORREO_QUEUE, { durable: true });
    
    console.log(`👂 Esperando mensajes en la cola: ${CORREO_QUEUE}`);

    channel.consume(CORREO_QUEUE, async (msg) => {
        if (msg !== null) {
            try {
                const orden = JSON.parse(msg.content.toString());
                console.log('📬 Mensaje recibido:', orden);
                
                // Preparamos datos manejando nulos
                const clienteId = orden.clienteId ? Number(orden.clienteId) : null;
                const nombres = orden.nombres || null;
                const email = orden.email || null;
                const motivo = orden.motivo || null;
                
                // Guardamos en MySQL
                const query = `
                    INSERT INTO correos_enviados (cliente_id, nombres, email_destino, motivo)
                    VALUES (?, ?, ?, ?)
                `;
                
                await dbConnectionCorreos.execute(query, [
                    clienteId, nombres, email, motivo
                ]);
                
                console.log(`✅ Correo registrado en BD para Cliente ID: ${clienteId}`);
                
                // Confirmamos a RabbitMQ que el mensaje se procesó
                channel.ack(msg);
                
            } catch (error) {
                console.error('❌ Error al registrar correo:', error.message);
                // Rechazamos el mensaje (nack) para que se reencole y se intente después
                channel.nack(msg, false, true); 
            }
        }
    });
};

const init = async () => {
    
    // 1. Conexión a MySQL
    try {
        dbConnectionCorreos = await mysql.createConnection(CORREOS_DB_CONFIG);
        console.log('✅ Conexión a MySQL (Correos) exitosa.');
    } catch (error) {
        console.error('❌ Error al conectar a MySQL (Correos):', error.message);
        process.exit(1);
    }
    
    // 2. Conexión a RabbitMQ (USANDO REINTENTOS)
    try {
        rabbitMqChannel = await connectRabbitMQ(); // <- Llamamos a la función con reintentos
        await startConsumer(rabbitMqChannel);

    } catch (error) {
        // Este catch solo se activa si fallaron todos los 5 reintentos.
        console.error('❌ Error fatal: No se pudo conectar a RabbitMQ.', error.message);
        process.exit(1); 
    }

    // 3. Servidor Hapi (Para mantener el contenedor vivo y healthchecks)
    const server = Hapi.server({
        port: 3002, 
        host: '0.0.0.0'
    });
    
    await server.start();
    console.log(`🚀 Microservicio de Correos corriendo en: ${server.info.uri}`);
};

process.on('unhandledRejection', (err) => {
    console.error('Unhandled Rejection:', err);
    process.exit(1);
});

init();