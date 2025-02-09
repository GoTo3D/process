const amqp = require("amqplib/callback_api");
const ProcessManager = require("./ProcessManager")
const dotenv = require("dotenv");

dotenv.config();

const QUEUE_CONNECTION_STRING = process.env.QUEUE_CONNECTION_STRING;
const QUEUE = process.env.QUEUE_CONNECTION_STRING || "processing-dev"

/**
 * Gestisce un singolo processo dalla coda
 * @param {string} id - ID del progetto da processare
 */
const handler = async (id) => {
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
 * Inizializza la connessione AMQP e il consumer della coda
 */
amqp.connect(
  QUEUE_CONNECTION_STRING,
  function (connectionError, connection) {
    if (connectionError) throw connectionError;
    console.log("[OK] Connected to amqp!")
    connection.createChannel(function (channelError, channel) {
      if (channelError) throw channelError;
      console.log("[OK] Channel created!")

      channel.assertQueue(QUEUE, { durable: true });

      console.log(" [*] Waiting for messages in %s. To exit press CTRL+C");

      channel.prefetch(1);

      channel.consume(
        QUEUE,
        async (msg) => {
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
