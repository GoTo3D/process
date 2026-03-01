const amqp = require('amqplib');
const { z } = require('zod');
const config = require('./config');
const ProcessManager = require('./ProcessManager');

const QUEUE = config.QUEUE;

let isShuttingDown = false;
let connection = null;
let channel = null;

// Schema per il messaggio dalla coda
// Supporta sia un semplice numero come stringa, sia un JSON con { id }
const QueueMessageSchema = z.union([
  z.string().regex(/^\d+$/).transform(Number),
  z.object({ id: z.number().int().positive() }).transform(obj => obj.id),
]);

/**
 * Parsa e valida il messaggio dalla coda
 * @param {string} raw
 * @returns {import('zod').SafeParseReturnType<unknown, number>}
 */
const parseQueueMessage = (raw) => {
  // Tenta il JSON parse solo se sembra un oggetto JSON
  if (raw.startsWith('{')) {
    try {
      return QueueMessageSchema.safeParse(JSON.parse(raw));
    } catch {
      // JSON malformato, fallira' la validazione come stringa
    }
  }
  return QueueMessageSchema.safeParse(raw);
};

/**
 * Gestisce un singolo processo dalla coda
 * @param {number} id
 */
const handler = async (id) => {
  const processManager = await ProcessManager.create(id);
  await processManager.process();
};

/**
 * Connessione AMQP con retry e exponential backoff
 * @param {number} maxRetries
 * @returns {Promise<import('amqplib').Connection>}
 */
async function connectWithRetry(maxRetries = 10) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const conn = await amqp.connect(config.QUEUE_CONNECTION_STRING);
      console.log('[OK] Connected to AMQP');
      return conn;
    } catch (err) {
      console.error(`AMQP connection attempt ${attempt}/${maxRetries} failed:`, err.message);
      if (attempt === maxRetries) {
        throw new Error(`Failed to connect to AMQP after ${maxRetries} attempts`);
      }
      const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

/**
 * Avvia il consumer AMQP
 */
async function startConsumer() {
  connection = await connectWithRetry();

  connection.on('error', (err) => {
    console.error('[AMQP] Connection error:', err.message);
  });

  connection.on('close', () => {
    if (!isShuttingDown) {
      console.error('[AMQP] Connection closed unexpectedly, reconnecting...');
      setTimeout(() => startConsumer().catch(err => {
        console.error('[AMQP] Reconnection failed:', err.message);
        process.exit(1);
      }), 5000);
    }
  });

  channel = await connection.createChannel();
  console.log('[OK] Channel created');

  // DLQ per messaggi falliti
  await channel.assertQueue(`${QUEUE}-dlq`, { durable: true });
  await channel.assertQueue(QUEUE, {
    durable: true,
    arguments: {
      'x-dead-letter-exchange': '',
      'x-dead-letter-routing-key': `${QUEUE}-dlq`,
    }
  });

  channel.prefetch(1);

  console.log(` [*] Waiting for messages in ${QUEUE}. To exit press CTRL+C`);

  channel.consume(QUEUE, async (msg) => {
    if (!msg) return;

    if (isShuttingDown) {
      channel.nack(msg, false, true);
      return;
    }

    const content = msg.content.toString();
    console.log(' [x] Received', content);

    const result = parseQueueMessage(content);
    if (!result.success) {
      console.error('Invalid queue message:', result.error.format());
      channel.ack(msg); // Ack per non ri-processare messaggi malformati
      return;
    }

    const id = result.data;

    try {
      await handler(id);
      console.log(' [x] Done', id);
      channel.ack(msg);
    } catch (error) {
      console.error(`Processing failed for ID ${id}:`, error.message);
      // Nack senza requeue: il messaggio va in DLQ
      channel.nack(msg, false, false);
    }
  }, { noAck: false });
}

// Graceful shutdown con timeout forzato
const shutdown = async (signal) => {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\n[${signal}] Shutting down gracefully...`);

  const forceExit = setTimeout(() => {
    console.error('Shutdown timeout, forcing exit');
    process.exit(1);
  }, 10000);

  try {
    if (channel) {
      await channel.close();
      console.log('[OK] Channel closed');
    }
    if (connection) {
      await connection.close();
      console.log('[OK] Connection closed');
    }
  } catch (error) {
    console.error('Error during shutdown:', error.message);
  }

  clearTimeout(forceExit);
  process.exit(0);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Avvio
startConsumer().catch((err) => {
  console.error('Failed to start consumer:', err);
  process.exit(1);
});
