const amqp = require("amqplib/callback_api");
const ProcessManager = require("./ProcessManager")
const dotenv = require("dotenv");

dotenv.config();

const QUEUE_CONNECTION_STRING = process.env.QUEUE_CONNECTION_STRING;
const QUEUE = process.env.QUEUE || "processing-dev"

// Validazione variabili d'ambiente obbligatorie
if (!QUEUE_CONNECTION_STRING) {
  throw new Error('QUEUE_CONNECTION_STRING environment variable is required');
}

// Riferimenti per graceful shutdown
let amqpConnection = null;
let amqpChannel = null;
let isShuttingDown = false;

/**
 * Valida l'ID del progetto ricevuto dalla coda
 * @param {string} rawId - ID grezzo dalla coda
 * @returns {number|null} ID validato come numero intero o null se non valido
 */
const validateProjectId = (rawId) => {
  if (typeof rawId !== 'string') return null;

  const trimmed = rawId.trim();
  // Verifica che sia un numero intero positivo
  if (!/^\d+$/.test(trimmed)) return null;

  const id = parseInt(trimmed, 10);
  // Verifica range ragionevole (previene overflow)
  if (id <= 0 || id > Number.MAX_SAFE_INTEGER) return null;

  return id;
};

/**
 * Gestisce un singolo processo dalla coda
 * @param {string} rawId - ID del progetto da processare (non validato)
 */
const handler = async (rawId) => {
  const id = validateProjectId(rawId);

  if (id === null) {
    console.error(`Invalid project ID received: ${rawId}`);
    return;
  }

  try {
    // Crea una nuova istanza di ProcessManager per questo progetto
    const processManager = await ProcessManager.create(id);

    // Esegue il processo completo
    await processManager.process();
  } catch (error) {
    console.error(`Handler error for ID ${id}:`, error);
  }
};

/**
 * Graceful shutdown - chiude connessioni AMQP in modo pulito
 */
const shutdown = async (signal) => {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\n[${signal}] Shutting down gracefully...`);

  try {
    if (amqpChannel) {
      await amqpChannel.close();
      console.log("[OK] Channel closed");
    }
    if (amqpConnection) {
      await amqpConnection.close();
      console.log("[OK] Connection closed");
    }
  } catch (error) {
    console.error("Error during shutdown:", error);
  }

  process.exit(0);
};

// Registra handler per segnali di terminazione
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

/**
 * Inizializza la connessione AMQP e il consumer della coda
 */
amqp.connect(
  QUEUE_CONNECTION_STRING,
  function (connectionError, connection) {
    if (connectionError) throw connectionError;
    amqpConnection = connection;
    console.log("[OK] Connected to amqp!")

    connection.on('error', (err) => {
      console.error('[AMQP] Connection error:', err.message);
    });

    connection.on('close', () => {
      if (!isShuttingDown) {
        console.error('[AMQP] Connection closed unexpectedly');
        process.exit(1);
      }
    });

    connection.createChannel(function (channelError, channel) {
      if (channelError) throw channelError;
      amqpChannel = channel;
      console.log("[OK] Channel created!")

      channel.assertQueue(QUEUE, { durable: true });
      console.log(` [*] Waiting for messages in ${QUEUE}. To exit press CTRL+C`);

      channel.prefetch(1);

      channel.consume(
        QUEUE,
        async (msg) => {
          if (isShuttingDown) {
            // Non processare nuovi messaggi durante lo shutdown
            channel.nack(msg, false, true);
            return;
          }
          console.log(" [x] Received %s", msg.content.toString());
          await handler(msg.content.toString());
          console.log("[x] Done", msg.content.toString());
          channel.ack(msg);
        },
        { noAck: false }
      );
    });
  }
);
