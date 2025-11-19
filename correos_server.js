'use strict';

const Hapi = require('@hapi/hapi');
const mysql = require('mysql2/promise');
const amqp = require('amqplib'); 

// --- CONFIGURACIÓN DE CONEXIÓN ---
const CORREOS_DB_CONFIG = {
    host: 'localhost',
    user: 'root', 
    password: '', 
    database: 'correosDB', // Base de datos privada del MS Correos
    port: 3306 
};

const RABBITMQ_URI = 'amqp://localhost';
const CORREO_QUEUE = 'cola_correos';

let dbConnectionCorreos;

/**
 * Función que inicia el consumidor de RabbitMQ para procesar órdenes de correo.
 */
const startConsumer = async (channel) => {
    await channel.assertQueue(CORREO_QUEUE, { durable: true });
    
    console.log(`👂 Esperando mensajes en la cola: ${CORREO_QUEUE}. Presiona CTRL+C para salir.`);

    // Establece el consumidor
    channel.consume(CORREO_QUEUE, async (msg) => {
        if (msg !== null) {
            
            try {
                const orden = JSON.parse(msg.content.toString());
                console.log('📬 Mensaje recibido:', orden);
                
                // ⚠️ CORRECCIÓN CLAVE para el TypeError: 
                // Aseguramos que no haya valores 'undefined'. Si falta un campo en la orden,
                // usamos 'null' para MySQL (que sí acepta valores null en la DB si la columna lo permite).
                // También aseguramos que clienteId sea un número.
                const clienteId = orden.clienteId ? Number(orden.clienteId) : null;
                const nombres = orden.nombres || null;
                const email = orden.email || null;
                const motivo = orden.motivo || null;
                
                // 3.2, 3.3: Registrar la información en la tabla de correos enviados.
                // Usamos la consulta optimizada de 4 campos que recibimos.
                const query = `
                    INSERT INTO correos_enviados (cliente_id, nombres, email_destino, motivo)
                    VALUES (?, ?, ?, ?)
                `;
                
                await dbConnectionCorreos.execute(query, [
                    clienteId, nombres, email, motivo
                ]);
                
                console.log(`Registro de correo exitoso para Cliente ID: ${clienteId}`);
                
                // Reconoce el mensaje para que RabbitMQ lo elimine de la cola
                channel.ack(msg);
                
            } catch (error) {
                // Si la consulta falla (ej. error de DB o de sintaxis)
                console.error('❌ Error al procesar o registrar correo en MySQL:', error);
                
                // ⚠️ Manejo de error: Rechaza el mensaje y lo devuelve a la cola (nack) para reintento.
                // Esto detiene el reintento inmediato que causaba el "ciclo infinito".
                channel.nack(msg); 
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
    
    // 2. Conexión y Consumidor de RabbitMQ
    try {
        const connection = await amqp.connect(RABBITMQ_URI);
        const channel = await connection.createChannel();
        console.log('✅ Conexión a RabbitMQ exitosa.');
        
        // Inicia el consumidor
        await startConsumer(channel);

    } catch (error) {
        console.error('❌ Error al conectar o iniciar consumidor de RabbitMQ:', error.message);
    }

    // 3. Configuración mínima del Servidor Hapi (Solo para levantarlo)
    const server = Hapi.server({
        port: 3002, 
        host: 'localhost'
    });
    
    await server.start();
    console.log(`🚀 Microservicio de Correos corriendo en: ${server.info.uri} (Consumidor Activo)`);
};

// Manejo de errores de rechazo no controlado y ejecución
process.on('unhandledRejection', (err) => {
    console.error('Unhandled Rejection:', err);
    process.exit(1);
});

init();