# Piano Implementazione - Best Practices

Questo piano copre tutti i miglioramenti di best practices. Alcuni prerequisiti (config centralizzata, dotenv) sono gia' coperti nel piano sicurezza e non vengono ripetuti.

---

## Step 1 - Fix `sendMessage` Telegram fire-and-forget (issue 2.3)

**Modificare `src/utils/telegram.js`:**

```js
const bot = require('../lib/telegramClient');

const sendMessage = async (user_id, message) => {
  await bot.telegram.sendMessage(user_id, message);
};

const sendDocument = async (user_id, source) => {
  await bot.telegram.sendDocument(user_id, { source });
};

module.exports = { sendMessage, sendDocument };
```

**Modificare `src/ProcessManager.js`, metodo `notifyTelegram()`:**

```js
async notifyTelegram() {
  if (!this.isTelegram) return;

  const data = await getTelegramUser(this.project.telegram_user);

  // Aggiungere await alle chiamate
  await sendMessage(data.user_id, `Processing done for process ${this.id}`);
  await sendMessage(data.user_id, `You can download the model from this link: ${SUPABASE_URL}/viewer/${this.id}`);

  const source = path.join(this.outDir, 'model.usdz');
  await sendDocument(data.user_id, source);
}
```

**File da modificare:** `src/utils/telegram.js`, `src/ProcessManager.js`

---

## Step 2 - Migrare AMQP a Promise API con reconnection (issue 2.4, 2.8)

Riscrivere `src/processQueue.js` usando l'API promise-based di amqplib e aggiungendo reconnection con exponential backoff.

**Riscrivere `src/processQueue.js`:**

```js
const amqp = require('amqplib');
const ProcessManager = require('./ProcessManager');
const config = require('./config');

const QUEUE = config.QUEUE;
let isShuttingDown = false;
let connection = null;
let channel = null;

const validateProjectId = (rawId) => {
  if (typeof rawId !== 'string') return null;
  const trimmed = rawId.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const id = parseInt(trimmed, 10);
  if (id <= 0 || id > Number.MAX_SAFE_INTEGER) return null;
  return id;
};

const handler = async (rawId) => {
  const id = validateProjectId(rawId);
  if (id === null) {
    console.error(`Invalid project ID received: ${rawId}`);
    return;
  }

  const processManager = await ProcessManager.create(id);
  await processManager.process();
};

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

  await channel.assertQueue(QUEUE, { durable: true });
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

    try {
      await handler(content);
      console.log(' [x] Done', content);
      channel.ack(msg);
    } catch (error) {
      console.error(`Processing failed for ${content}:`, error.message);
      // Nack senza requeue: il messaggio va in DLQ se configurata
      channel.nack(msg, false, false);
    }
  }, { noAck: false });
}

// Graceful shutdown con timeout forzato
const shutdown = async (signal) => {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\n[${signal}] Shutting down gracefully...`);

  // Timeout di sicurezza: forza l'uscita dopo 10 secondi
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

// Avvio
startConsumer().catch((err) => {
  console.error('Failed to start consumer:', err);
  process.exit(1);
});
```

**File da modificare:** `src/processQueue.js`

---

## Step 3 - Implementare nack con distinzione errori (issue 2.9)

Gia' incluso nello Step 2 sopra. Il consumer ora distingue:
- **Successo**: `channel.ack(msg)`
- **Errore**: `channel.nack(msg, false, false)` - il messaggio non viene rimesso in coda

Per un sistema piu' robusto, configurare una Dead Letter Queue su RabbitMQ:

```js
// Nella assertQueue, aggiungere DLQ
await channel.assertQueue(`${QUEUE}-dlq`, { durable: true });
await channel.assertQueue(QUEUE, {
  durable: true,
  arguments: {
    'x-dead-letter-exchange': '',
    'x-dead-letter-routing-key': `${QUEUE}-dlq`,
  }
});
```

**File da modificare:** `src/processQueue.js` (gia' coperto nello step 2)

---

## Step 4 - Fix `package.json` (issue 2.6)

**Modificare `package.json`:**

```json
{
  "name": "config-3d-process",
  "version": "1.0.0",
  "description": "3D model processing service via photogrammetry",
  "main": "src/processQueue.js",
  "engines": {
    "node": ">=22.0.0"
  },
  "scripts": {
    "dev": "node --env-file=.env src/processQueue.js",
    "start": "node src/processQueue.js",
    "test": "node test/unit/processManager.test.js",
    "test:unit": "node test/unit/processManager.test.js",
    "test:integration": "node test/integration/processOnly.test.js",
    "test:local": "node test/integration/processLocal.test.js",
    "test:e2e": "node test/e2e/fullProcess.test.js"
  },
  "keywords": ["photogrammetry", "3d-processing"],
  "author": "",
  "license": "ISC",
  "dependencies": {
    "@aws-sdk/client-s3": "^3.616.0",
    "@smithy/node-http-handler": "^3.0.0",
    "@supabase/supabase-js": "^2.43.2",
    "amqplib": "^0.10.3",
    "dotenv": "^16.3.1",
    "mime-types": "^2.1.35",
    "telegraf": "^4.16.3",
    "undici": "^6.10.1",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "concurrently": "^8.2.2"
  }
}
```

Cambiamenti:
1. `main` corretto a `src/processQueue.js`
2. Rimosso `path` (built-in Node.js)
3. Rimosso `fastq` (non usato nel codice)
4. Spostato `dotenv` da devDependencies a dependencies
5. Aggiunto campo `engines`
6. Aggiunto `zod` e `@smithy/node-http-handler` (dal piano sicurezza)
7. Script `dev` usa `--env-file` nativo

**File da modificare:** `package.json`

---

## Step 5 - Fix `for await` su array sincroni (issue 2.7)

**Modificare `src/utils/s3.js`:**

Funzione `walk`:
```js
// PRIMA
for await (const file of files) {

// DOPO
for (const file of files) {
```

Funzione `_uploadDir`:
```js
// PRIMA
for await (const { file, filename } of _files) {

// DOPO
for (const { file, filename } of _files) {
```

**File da modificare:** `src/utils/s3.js`

---

## Step 6 - Aggiungere `.gitignore` e rimuovere `.DS_Store` (issue 2.13)

**Creare/aggiornare `.gitignore`:**

```
node_modules/
.env
.DS_Store
*.log
```

**Comandi git:**
```bash
git rm --cached .DS_Store
git rm --cached src/.DS_Store
```

**File da creare/modificare:** `.gitignore`

---

## Step 7 - Path di lavoro configurabile (issue 2.12)

Gia' gestito dal piano sicurezza Step 1 (config.js include `PROJECTS_BASE_DIR`).

**Modificare `src/ProcessManager.js`:**

```js
const config = require('./config');

class ProcessManager {
  constructor(id, project) {
    this.id = id;
    this.project = project;
    this.imgDir = path.join(config.PROJECTS_BASE_DIR, `${id}`, 'images');
    this.outDir = path.join(config.PROJECTS_BASE_DIR, `${id}`, 'model');
    this.isTelegram = !!project.telegram_user;
  }
}
```

Aggiungere `PROJECTS_BASE_DIR` anche a `.env.example`:
```
# Processing directory
PROJECTS_BASE_DIR=/Volumes/T7/projects
```

**File da modificare:** `src/ProcessManager.js`, `.env.example`

---

## Step 8 - Graceful shutdown con timeout forzato (issue 2.11)

Gia' incluso nello Step 2 (riscrittura di processQueue.js). Il timeout di 10 secondi forza l'uscita se la chiusura si blocca.

---

## Step 9 - Handler per unhandledRejection (issue 2.14)

**Aggiungere in `src/processQueue.js`** (nella nuova versione dello Step 2):

```js
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Non fare exit: logga e lascia che il processo continui
  // L'errore potrebbe essere recuperabile
});
```

**File da modificare:** `src/processQueue.js`

---

## Step 10 - Validazione Zod per il messaggio dalla coda (nuovo)

Aggiungere validazione strutturata al messaggio ricevuto dalla coda. Attualmente il messaggio e' un semplice ID numerico, ma con Zod possiamo rendere la validazione piu' robusta e pronta per eventuali cambiamenti di formato.

**Aggiungere in `src/processQueue.js`:**

```js
const { z } = require('zod');

// Schema per il messaggio dalla coda
// Supporta sia un semplice numero come stringa, sia un JSON con id
const QueueMessageSchema = z.union([
  z.string().regex(/^\d+$/).transform(Number),
  z.object({ id: z.number().int().positive() }).transform(obj => obj.id),
]);

const parseQueueMessage = (raw) => {
  let input = raw;
  try {
    input = JSON.parse(raw);
  } catch {
    // Non e' JSON, usa come stringa
  }
  return QueueMessageSchema.safeParse(input);
};

// Nel consumer:
const result = parseQueueMessage(content);
if (!result.success) {
  console.error('Invalid queue message:', result.error.format());
  channel.ack(msg); // ack per non reprocessare messaggi malformati
  return;
}
const id = result.data;
```

**File da modificare:** `src/processQueue.js`

---

## Ordine di esecuzione consigliato

1. Step 1 - Fix `sendMessage` Telegram
2. Step 2 - Riscrittura AMQP con Promise API + reconnection + shutdown timeout
3. Step 3 - DLQ (configurazione RabbitMQ)
4. Step 4 - Fix `package.json`
5. Step 5 - Fix `for await`
6. Step 6 - `.gitignore`
7. Step 7 - Path configurabile (dipende da config.js del piano sicurezza)
8. Step 9 - unhandledRejection handler
9. Step 10 - Validazione Zod messaggi coda

## File impattati

| File | Step |
|------|------|
| `src/utils/telegram.js` | 1 |
| `src/ProcessManager.js` | 1, 7 |
| `src/processQueue.js` | 2, 3, 8, 9, 10 |
| `package.json` | 4 |
| `src/utils/s3.js` | 5 |
| `.gitignore` (NUOVO) | 6 |
| `.env.example` | 7 |
