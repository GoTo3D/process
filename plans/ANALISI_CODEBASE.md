# Analisi Codebase - 3D Model Processing Service

Analisi completa dell'implementazione dal punto di vista di **sicurezza**, **best practices** e **performance**.

---

## 1. SICUREZZA

### 1.1 CRITICA - Command Injection via `exec()` con string interpolation

**File:** `src/ProcessManager.js:142-143, 174`

I comandi shell sono costruiti con template literals e passati a `exec()`, che spawna una shell completa:

```js
const command = `cd ${libDir} && ./HelloPhotogrammetry ${_imgDir} ${_outDir}model.usdz -d ${detail} -o ${ordering} -f ${feature}`;
```

Sebbene i parametri (`detail`, `ordering`, `feature`) siano validati tramite whitelist, i path `_imgDir` e `_outDir` sono derivati da `this.id`. L'ID e' validato come intero, quindi il rischio attuale e' basso, ma il pattern resta pericoloso.

**Miglioramento:** Usare `execFile()` o `spawn()` con array di argomenti, che non invocano la shell:

```js
const { execFile } = require('child_process');
execFile('./HelloPhotogrammetry', [_imgDir, `${_outDir}model.usdz`, '-d', detail, '-o', ordering, '-f', feature], { cwd: libDir, timeout: PHOTOGRAMMETRY_TIMEOUT }, callback);
```

---

### 1.2 ALTA - Bypass potenziale della validazione SSRF su URL Telegram

**File:** `src/utils/s3.js:39`

```js
ALLOWED_TELEGRAM_HOSTS.some(host => parsed.hostname.endsWith(host));
```

`.endsWith('api.telegram.org')` matcherebbe anche `evil-api.telegram.org`. In teoria i sottodomini di telegram.org sono controllati, ma il pattern e' fragile.

**Miglioramento:** Usare match esatto o validazione con punto di separazione:

```js
ALLOWED_TELEGRAM_HOSTS.some(host =>
  parsed.hostname === host || parsed.hostname.endsWith('.' + host)
);
```

---

### 1.3 ALTA - File sorgente cancellati prima del completamento del processing

**File:** `src/utils/s3.js:114`

```js
// delete the file from supabase only after successful write
await deleteObject(BUCKET, location);
```

I file vengono cancellati dallo storage remoto subito dopo il download, **prima** che il modello 3D sia stato generato con successo. Se il processing fallisce (crash, timeout, errore di conversione), i file originali sono persi irrimediabilmente.

**Miglioramento:** Spostare la cancellazione dallo storage remoto a **dopo** il completamento con successo dell'intero pipeline, oppure implementare una coda di cancellazione separata.

---

### 1.4 MEDIA - Credenziali non validate in `supabaseClient.js` e `telegramClient.js`

**File:** `src/lib/supabaseClient.js:4-5`, `src/lib/telegramClient.js:4`

```js
const supabaseUrl = process.env.SUPABASE_URL;  // potrebbe essere undefined
const supabaseKey = process.env.SUPABASE_KEY;   // potrebbe essere undefined
const bot = new Telegraf(BOT_TOKEN);            // BOT_TOKEN potrebbe essere undefined
```

A differenza di `s3Client.js` che valida le variabili d'ambiente, questi moduli non effettuano alcuna validazione e produrranno errori criptici a runtime.

**Miglioramento:** Validare tutte le env var obbligatorie all'avvio, idealmente con un modulo di configurazione centralizzato (vedi sezione 2.2).

---

### 1.5 MEDIA - Nessun limite sulla dimensione dei file scaricati

**File:** `src/utils/s3.js:141, 105`

Non esiste alcun controllo sulla dimensione dei file scaricati da Telegram o S3. Un file malevolo di grandi dimensioni potrebbe esaurire il disco.

**Miglioramento:** Aggiungere controlli sulla dimensione usando l'header `Content-Length` prima del download e monitorare lo spazio disco disponibile.

---

### 1.6 BASSA - Log di dati potenzialmente sensibili

**File:** `src/processQueue.js:130`

```js
console.log(" [x] Received %s", msg.content.toString());
```

Il contenuto dei messaggi della coda viene loggato direttamente. Attualmente contiene solo ID numerici, ma se il formato del messaggio cambiasse potrebbe esporre dati sensibili.

**Miglioramento:** Loggare solo informazioni necessarie e usare un logger strutturato con redaction (vedi sezione 2.5).

---

### 1.7 BASSA - Configurazione S3 Client con `requestHandler` errato

**File:** `src/lib/s3Client.js:38-45`

```js
requestHandler: new https.Agent({ ... })
```

L'AWS SDK v3 si aspetta un `NodeHttpHandler`, non un `https.Agent` raw. Questo potrebbe causare comportamenti imprevisti o essere silenziosamente ignorato.

**Miglioramento:**

```js
const { NodeHttpHandler } = require('@smithy/node-http-handler');
requestHandler: new NodeHttpHandler({
  connectionTimeout: 5000,
  socketTimeout: 5000,
  httpsAgent: new https.Agent({ keepAlive: true, maxSockets: 50 })
})
```

---

## 2. BEST PRACTICES

### 2.1 CRITICA - `dotenv.config()` chiamato in 6 file diversi

**File:** `processQueue.js`, `ProcessManager.js`, `s3.js`, `s3Client.js`, `supabaseClient.js`, `telegramClient.js`

`dotenv.config()` viene invocato in quasi ogni modulo. Questo e' un anti-pattern: dovrebbe essere chiamato **una sola volta** all'entry point (`processQueue.js`), prima di qualsiasi import che acceda a `process.env`.

**Miglioramento:** Rimuovere `dotenv.config()` da tutti i file tranne `processQueue.js`, e assicurarsi che sia la prima istruzione eseguita. Meglio ancora, usare il flag `--env-file` nativo di Node.js 22+:

```bash
node --env-file=.env src/processQueue.js
```

---

### 2.2 ALTA - Mancanza di validazione centralizzata della configurazione

Le variabili d'ambiente sono lette e validate in modo frammentario in diversi file. Alcune sono validate (`s3Client.js`), altre no (`supabaseClient.js`, `telegramClient.js`).

**Miglioramento:** Creare un modulo `src/config.js` centralizzato che validi tutte le env var all'avvio:

```js
const requiredVars = ['SUPABASE_URL', 'SUPABASE_KEY', 'BOT_TOKEN',
  'CLOUDFLARE_R2_ACCOUNT_ID', 'CLOUDFLARE_R2_ACCESS_KEY_ID',
  'CLOUDFLARE_R2_SECRET_ACCESS_KEY', 'QUEUE_CONNECTION_STRING'];

for (const v of requiredVars) {
  if (!process.env[v]) throw new Error(`Missing required env var: ${v}`);
}

module.exports = { supabaseUrl: process.env.SUPABASE_URL, /* ... */ };
```

---

### 2.3 ALTA - `sendMessage` Telegram fire-and-forget senza await

**File:** `src/utils/telegram.js:3-4`

```js
const sendMessage = (user_id, message) => {
    bot.telegram.sendMessage(user_id, message);  // Promise non awaited!
}
```

La funzione `sendMessage` non e' `async` e non fa `await` ne' `.catch()`. Se l'invio fallisce, l'errore viene perso silenziosamente come unhandled rejection.

In `ProcessManager.js:202-204`, `sendMessage` e' chiamato due volte senza `await`.

**Miglioramento:** Rendere la funzione `async` e fare `await` su tutte le chiamate:

```js
const sendMessage = async (user_id, message) => {
    await bot.telegram.sendMessage(user_id, message);
}
```

---

### 2.4 ALTA - Nessuna strategia di reconnection AMQP

**File:** `src/processQueue.js:105-109`

```js
connection.on('close', () => {
  if (!isShuttingDown) {
    console.error('[AMQP] Connection closed unexpectedly');
    process.exit(1);
  }
});
```

Se la connessione AMQP cade (riavvio RabbitMQ, problema di rete), il processo termina con `exit(1)`. In produzione questo richiede un supervisor esterno (PM2, systemd) per il restart.

**Miglioramento:** Implementare reconnection con exponential backoff:

```js
async function connectWithRetry(maxRetries = 10) {
  for (let i = 1; i <= maxRetries; i++) {
    try {
      return await amqp.connect(QUEUE_CONNECTION_STRING);
    } catch (err) {
      console.error(`AMQP connection attempt ${i}/${maxRetries} failed`);
      await new Promise(r => setTimeout(r, Math.min(1000 * Math.pow(2, i), 30000)));
    }
  }
  throw new Error('Failed to connect to AMQP after max retries');
}
```

---

### 2.5 ALTA - Assenza di logging strutturato

Tutto il codebase usa `console.log`, `console.error`, `console.time`. In produzione questo produce log non strutturati, difficili da analizzare e senza livelli di severita'.

**Miglioramento:** Adottare [pino](https://github.com/pinojs/pino) per logging strutturato in JSON:

```js
const pino = require('pino');
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

logger.info({ projectId: id }, 'Starting process');
logger.error({ err, projectId: id }, 'Process failed');
```

---

### 2.6 MEDIA - `package.json` con errori e dipendenze inutili

**File:** `package.json`

1. **`"main": "lib/processQueue.js"`** - Il path corretto e' `src/processQueue.js`
2. **`"path": "^0.12.7"`** - `path` e' un modulo built-in di Node.js, non serve come dipendenza
3. **`"dotenv"` in `devDependencies`** - Usato a runtime, dovrebbe essere in `dependencies` (oppure rimosso in favore di `--env-file`)
4. **Nessun campo `engines`** - Non specifica la versione minima di Node.js richiesta

---

### 2.7 MEDIA - `for await` usato su array sincroni

**File:** `src/utils/s3.js:48, 70`

```js
for await (const file of files) { ... }      // walk()
for await (const { file, filename } of _files) { ... }  // _uploadDir()
```

`for await...of` e' pensato per async iterables. Usato su array normali e' inutile e leggermente piu' lento.

**Miglioramento:** Usare `for...of`:

```js
for (const file of files) { ... }
```

---

### 2.8 MEDIA - AMQP con callback API invece di Promise API

**File:** `src/processQueue.js:94-139`

`amqplib` offre sia l'API callback (`amqplib/callback_api`) sia quella promise-based (`amqplib`). Il codice usa i callback, risultando in nesting profondo e difficile da leggere.

**Miglioramento:**

```js
const amqp = require('amqplib');

const connection = await amqp.connect(QUEUE_CONNECTION_STRING);
const channel = await connection.createChannel();
await channel.assertQueue(QUEUE, { durable: true });
channel.prefetch(1);
channel.consume(QUEUE, async (msg) => { ... }, { noAck: false });
```

---

### 2.9 MEDIA - Nessun messaggio ack/nack basato sul risultato

**File:** `src/processQueue.js:131-133`

```js
await handler(msg.content.toString());
console.log("[x] Done", msg.content.toString());
channel.ack(msg);
```

Il messaggio viene sempre fatto `ack` anche se l'handler lancia un'eccezione (l'errore e' catturato dentro `handler`). Non esiste Dead Letter Queue o meccanismo di retry a livello di coda.

**Miglioramento:** Differenziare tra errori temporanei (nack + requeue) e permanenti (nack + DLQ):

```js
try {
  await handler(msg.content.toString());
  channel.ack(msg);
} catch (error) {
  if (isTransientError(error)) {
    channel.nack(msg, false, true);  // requeue
  } else {
    channel.nack(msg, false, false); // send to DLQ
  }
}
```

---

### 2.10 MEDIA - `try-catch` ridondante in `sendDocument`

**File:** `src/utils/telegram.js:6-12`

```js
const sendDocument = async (user_id, source) => {
    try {
        await bot.telegram.sendDocument(user_id, { source });
    } catch (error) {
        throw error;  // Cattura solo per rilanciare - inutile
    }
}
```

---

### 2.11 BASSA - Graceful shutdown senza timeout forzato

**File:** `src/processQueue.js:65-85`

La funzione `shutdown` non ha un timeout forzato. Se `amqpChannel.close()` si blocca, il processo rimane appeso.

**Miglioramento:** Aggiungere un timeout di sicurezza:

```js
const shutdownTimeout = setTimeout(() => {
  console.error('Shutdown timeout, forcing exit');
  process.exit(1);
}, 10000);
```

---

### 2.12 BASSA - Path di lavoro hardcoded

**File:** `src/ProcessManager.js:60-61`

```js
this.imgDir = `/Volumes/T7/projects/${id}/images/`;
this.outDir = `/Volumes/T7/projects/${id}/model/`;
```

Il path `/Volumes/T7/` e' un disco esterno specifico della macchina corrente.

**Miglioramento:** Rendere configurabile tramite variabile d'ambiente:

```js
const BASE_DIR = process.env.PROJECTS_BASE_DIR || '/Volumes/T7/projects';
this.imgDir = path.join(BASE_DIR, `${id}`, 'images');
```

---

### 2.13 BASSA - `.DS_Store` tracciato in Git

**File:** `.DS_Store` (staged)

File macOS-specific di sistema non dovrebbe essere nel repository.

**Miglioramento:** Aggiungere `.DS_Store` al `.gitignore` e rimuoverlo dal tracking:

```bash
echo ".DS_Store" >> .gitignore
git rm --cached .DS_Store
```

---

### 2.14 BASSA - Mancanza di `unhandledRejection` handler

Nessun handler globale per `unhandledRejection`. Le promise non gestite (come `sendMessage` senza await) possono crashare il processo silenziosamente in versioni recenti di Node.js.

---

## 3. PERFORMANCE

### 3.1 ALTA - Upload sequenziale dei file del modello

**File:** `src/utils/s3.js:66-80`

```js
for await (const { file, filename } of _files) {
    await putObject(BUCKET, location, await file);  // uno alla volta
}
```

I file del modello (USDZ, OBJ, MTL, texture) vengono caricati uno alla volta. Con la latenza di rete verso Cloudflare R2, questo rallenta significativamente il processo.

**Miglioramento:** Upload parallelo con concorrenza limitata:

```js
const pLimit = require('p-limit');
const limit = pLimit(5);

const uploads = _files.map(({ file, filename }) =>
  limit(async () => {
    const location = `${bucket_location}/model/${filename}`;
    await putObject(BUCKET, location, await file);
    return location;
  })
);
return Promise.all(uploads);
```

---

### 3.2 ALTA - Download sequenziale dei file sorgente

**File:** `src/utils/s3.js:91-124`

```js
for (let i = 0; i < files.length; i++) {
    const get = await getObject(BUCKET, location);  // uno alla volta
    await fs.promises.writeFile(localLocation, get);
    await deleteObject(BUCKET, location);
}
```

Quando un progetto ha decine/centinaia di immagini, il download sequenziale e' molto lento.

**Miglioramento:** Download parallelo con concorrenza limitata (es. 5-10 concurrent downloads).

---

### 3.3 MEDIA - `walk()` legge i file in memoria durante la scansione

**File:** `src/utils/s3.js:54`

```js
ret.push({
    file: readFile(filepath),  // Promise<Buffer> creata subito
    ...
})
```

`readFile` viene chiamato durante il walk, avviando la lettura di **tutti** i file in parallelo. Se la directory contiene molti file grandi, questo puo' causare picchi di memoria.

**Miglioramento:** Ritardare la lettura a quando serve effettivamente, durante l'upload:

```js
ret.push({
    filepath,  // salva solo il path
    filename: file,
    contentType: mime.lookup(_path),
});
// Poi durante l'upload:
const data = await readFile(item.filepath);
```

---

### 3.4 MEDIA - Nessun limite di concorrenza su `Promise.all` per download Telegram

**File:** `src/utils/s3.js:141-142`

```js
const promises = validUrls.map((img) => request(img));
const responses = await Promise.all(promises);
```

Tutte le richieste HTTP partono simultaneamente senza limiti di concorrenza. Con molte immagini, questo puo' saturare le connessioni di rete o superare i rate limit di Telegram.

**Miglioramento:** Usare `p-limit` o `p-map` con concorrenza limitata.

---

### 3.5 MEDIA - stdout completo in memoria per la fotogrammetria

**File:** `src/ProcessManager.js:147`

```js
exec(command, { timeout: PHOTOGRAMMETRY_TIMEOUT }, (error, stdout, stderr) => {
    console.log(`stdout: ${stdout}`);
```

`exec` accumula tutto lo stdout in memoria. Per un processo di fotogrammetria che puo' durare 30 minuti, l'output potrebbe essere molto grande.

**Miglioramento:** Usare `spawn` con streaming dello stdout:

```js
const child = spawn('./HelloPhotogrammetry', args, { cwd: libDir });
child.stdout.on('data', (data) => logger.debug(data.toString()));
child.stderr.on('data', (data) => logger.warn(data.toString()));
```

---

### 3.6 BASSA - SDK v3 stream-to-buffer manuale

**File:** `src/lib/s3Api.js:24-28`

```js
stream.on('data', (chunk) => chunks.push(chunk));
stream.on('end', () => resolve(Buffer.concat(chunks)));
```

La conversione stream-to-buffer e' fatta manualmente.

**Miglioramento:** Usare il metodo built-in dell'AWS SDK v3:

```js
const response = await clientS3.send(new GetObjectCommand({ Bucket, Key }));
return Buffer.from(await response.Body.transformToByteArray());
```

---

### 3.7 BASSA - Nessun controllo spazio disco

Prima di scaricare immagini o generare modelli, non viene verificato lo spazio disco disponibile su `/Volumes/T7/`. Un disco pieno causerebbe errori criptici durante il processing.

---

### 3.8 BASSA - Cleanup incompleto dei file temporanei

**File:** `src/ProcessManager.js:224-226`

Solo `imgDir` viene cancellato dopo il processing. `outDir` (con i file del modello) non viene mai cancellato. Con il tempo, `/Volumes/T7/projects/` si riempira' di modelli.

**Miglioramento:** Aggiungere cleanup di `outDir` dopo l'upload su S3, o implementare una routine di pulizia periodica.

---

## 4. RIEPILOGO PRIORITA'

| # | Categoria | Severita' | Descrizione |
|---|-----------|-----------|-------------|
| 1.1 | Sicurezza | CRITICA | `exec()` con string interpolation - usare `execFile`/`spawn` |
| 2.1 | Best Practice | CRITICA | `dotenv.config()` multiplo - centralizzare |
| 1.3 | Sicurezza | ALTA | File sorgente cancellati prima del completamento |
| 2.2 | Best Practice | ALTA | Validazione configurazione frammentaria |
| 2.3 | Best Practice | ALTA | `sendMessage` Telegram senza await |
| 2.4 | Best Practice | ALTA | Nessuna reconnection AMQP |
| 2.5 | Best Practice | ALTA | Assenza di logging strutturato |
| 3.1 | Performance | ALTA | Upload file sequenziale |
| 3.2 | Performance | ALTA | Download file sequenziale |
| 1.2 | Sicurezza | ALTA | Bypass SSRF con `.endsWith()` |
| 1.4 | Sicurezza | MEDIA | Credenziali non validate |
| 1.5 | Sicurezza | MEDIA | Nessun limite dimensione file |
| 2.6 | Best Practice | MEDIA | Errori in `package.json` |
| 2.7 | Best Practice | MEDIA | `for await` su array sincroni |
| 2.8 | Best Practice | MEDIA | AMQP callback API |
| 2.9 | Best Practice | MEDIA | Nessun retry/DLQ per messaggi |
| 3.3 | Performance | MEDIA | `walk()` legge file eagerly |
| 3.4 | Performance | MEDIA | `Promise.all` senza concurrency limit |
| 3.5 | Performance | MEDIA | stdout in memoria per 30min |
| 1.7 | Sicurezza | BASSA | `requestHandler` S3 errato |
| 2.10-14 | Best Practice | BASSA | try-catch ridondante, shutdown timeout, path hardcoded, .DS_Store, unhandledRejection |
| 3.6-8 | Performance | BASSA | Stream-to-buffer manuale, no controllo disco, cleanup incompleto |
