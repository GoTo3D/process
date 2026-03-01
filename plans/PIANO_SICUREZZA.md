# Piano Implementazione - Sicurezza

Questo piano copre tutti i fix di sicurezza identificati nell'analisi, ordinati per priorita'.

---

## Prerequisito: Installare Zod

```bash
npm install zod
```

Zod viene usato in questo piano per la validazione degli input dalla coda e dal database.

---

## Step 1 - Creare `src/config.js` con validazione Zod (issue 1.4, 2.1, 2.2)

Questo step risolve 3 issue contemporaneamente: credenziali non validate, `dotenv` multiplo, e configurazione frammentaria.

**Creare il file `src/config.js`:**

```js
const { z } = require('zod');

// Carica dotenv UNA sola volta, qui
require('dotenv').config();

const ConfigSchema = z.object({
  // Supabase
  SUPABASE_URL: z.string().url(),
  SUPABASE_KEY: z.string().min(1),

  // Telegram
  BOT_TOKEN: z.string().min(1),

  // Cloudflare R2
  CLOUDFLARE_R2_ACCOUNT_ID: z.string().min(1),
  CLOUDFLARE_R2_ACCESS_KEY_ID: z.string().min(1),
  CLOUDFLARE_R2_SECRET_ACCESS_KEY: z.string().min(1),

  // Queue
  QUEUE_CONNECTION_STRING: z.string().min(1),
  QUEUE: z.string().default('processing-dev'),

  // Storage
  BUCKET: z.string().min(1),

  // Processing (nuova, rende configurabile il path)
  PROJECTS_BASE_DIR: z.string().default('/Volumes/T7/projects'),
});

const result = ConfigSchema.safeParse(process.env);

if (!result.success) {
  console.error('Invalid environment configuration:');
  console.error(result.error.format());
  process.exit(1);
}

module.exports = result.data;
```

**Modifiche necessarie in tutti gli altri file:**

- Rimuovere `require('dotenv').config()` da: `ProcessManager.js`, `s3.js`, `s3Client.js`, `supabaseClient.js`, `telegramClient.js`
- Importare le variabili da `src/config.js` invece di `process.env`

**Esempio - `src/lib/supabaseClient.js` dopo la modifica:**

```js
const { createClient } = require('@supabase/supabase-js');
const config = require('../config');

const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

module.exports = { supabase, BUCKET: config.BUCKET };
```

**Esempio - `src/lib/telegramClient.js` dopo la modifica:**

```js
const { Telegraf } = require('telegraf');
const config = require('../config');

const bot = new Telegraf(config.BOT_TOKEN);
module.exports = bot;
```

**Esempio - `src/lib/s3Client.js` dopo la modifica:**

```js
const { S3Client } = require('@aws-sdk/client-s3');
const { NodeHttpHandler } = require('@smithy/node-http-handler');
const https = require('https');
const config = require('../config');

// (rimuovere tutta la validazione manuale, ora gestita da config.js)

const clientS3 = new S3Client({
  region: 'auto',
  endpoint: `https://${config.CLOUDFLARE_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: config.CLOUDFLARE_R2_ACCESS_KEY_ID,
    secretAccessKey: config.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
  },
  // ... resto config
});
```

**File da modificare:** `src/lib/supabaseClient.js`, `src/lib/telegramClient.js`, `src/lib/s3Client.js`, `src/utils/s3.js`, `src/utils/db.js`, `src/ProcessManager.js`, `src/processQueue.js`

---

## Step 2 - Validazione Zod per i dati del progetto dal database (issue 1.4)

Aggiungere uno schema Zod in `src/utils/db.js` per validare i dati del progetto ricevuti da Supabase, evitando che dati corrotti o manipolati nel DB causino problemi a valle.

**Modificare `src/utils/db.js`:**

```js
const { z } = require('zod');
const { supabase } = require('../lib/supabaseClient');

const ProjectSchema = z.object({
  id: z.number().int().positive(),
  status: z.string(),
  files: z.array(z.string()).min(1, 'Project must have at least one file'),
  detail: z.string().optional().default('medium'),
  feature: z.string().optional().default('normal'),
  order: z.string().optional().default('unordered'),
  telegram_user: z.number().int().positive().nullable().optional(),
  process_start: z.string().nullable().optional(),
  process_end: z.string().nullable().optional(),
  model_urls: z.array(z.string()).nullable().optional(),
});

const TelegramUserSchema = z.object({
  user_id: z.union([z.string(), z.number()]),
});

const getProject = async (id) => {
  const { data, error } = await supabase
    .from('project')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw error;

  // Valida la struttura del progetto
  return ProjectSchema.parse(data);
};

const getTelegramUser = async (telegram_user) => {
  const { data, error } = await supabase
    .from('telegram_user')
    .select('user_id')
    .eq('id', telegram_user)
    .single();
  if (error) throw error;

  return TelegramUserSchema.parse(data);
};

const updateProject = async (id, updateObj) => {
  const { error } = await supabase
    .from('project')
    .update(updateObj)
    .eq('id', id);
  if (error) throw error;
};

module.exports = { getProject, getTelegramUser, updateProject };
```

**File da modificare:** `src/utils/db.js`

---

## Step 3 - Sostituire `exec()` con `execFile()` (issue 1.1)

Eliminare il rischio di command injection sostituendo `exec` (che invoca una shell) con `execFile` (che esegue il binario direttamente).

**Modificare `src/ProcessManager.js`:**

Cambiare l'import:
```js
// PRIMA
const { exec } = require('child_process');

// DOPO
const { execFile } = require('child_process');
```

Riscrivere `processModel()`:
```js
async processModel() {
  const detail = sanitizeParam(this.project.detail, ALLOWED_DETAILS, 'medium');
  const ordering = sanitizeParam(this.project.order, ALLOWED_ORDERINGS, 'unordered');
  const feature = sanitizeParam(this.project.feature, ALLOWED_FEATURES, 'normal');

  const bin = path.join(libDir, 'HelloPhotogrammetry');
  const args = [
    this.imgDir,
    path.join(this.outDir, 'model.usdz'),
    '-d', detail,
    '-o', ordering,
    '-f', feature
  ];

  console.log(`Executing: ${bin} ${args.join(' ')}`);

  return new Promise((resolve, reject) => {
    const child = execFile(bin, args, {
      timeout: PHOTOGRAMMETRY_TIMEOUT,
      maxBuffer: 10 * 1024 * 1024, // 10MB max stdout
    }, (error, stdout, stderr) => {
      if (stdout) console.log(`stdout: ${stdout}`);
      if (error) {
        if (stderr) console.error(`stderr: ${stderr}`);
        if (error.killed) {
          reject(new Error(`Process killed due to timeout (${PHOTOGRAMMETRY_TIMEOUT}ms)`));
        } else {
          reject(error);
        }
        return;
      }
      fs.promises
        .access(path.join(this.outDir, 'model.usdz'))
        .then(() => resolve('ok'))
        .catch(() => reject(new Error('Output file not found')));
    });

    child.on('error', (err) => reject(err));
  });
}
```

Riscrivere `convertModel()`:
```js
async convertModel() {
  const bin = path.join(libDir, 'usdconv');
  const args = [path.join(this.outDir, 'model.usdz')];

  return new Promise((resolve, reject) => {
    const child = execFile(bin, args, {
      timeout: CONVERSION_TIMEOUT,
    }, (error) => {
      if (error) {
        if (error.killed) {
          reject(new Error(`Conversion killed due to timeout (${CONVERSION_TIMEOUT}ms)`));
        } else {
          reject(error);
        }
        return;
      }
      resolve('ok');
    });

    child.on('error', (err) => reject(err));
  });
}
```

**File da modificare:** `src/ProcessManager.js`

---

## Step 4 - Fix validazione SSRF Telegram (issue 1.2)

**Modificare `src/utils/s3.js`, funzione `isValidTelegramUrl`:**

```js
// PRIMA
const isValidTelegramUrl = (url) => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' &&
      ALLOWED_TELEGRAM_HOSTS.some(host => parsed.hostname.endsWith(host));
  } catch {
    return false;
  }
};

// DOPO
const isValidTelegramUrl = (url) => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' &&
      ALLOWED_TELEGRAM_HOSTS.some(host =>
        parsed.hostname === host || parsed.hostname.endsWith('.' + host)
      );
  } catch {
    return false;
  }
};
```

**File da modificare:** `src/utils/s3.js`

---

## Step 5 - Spostare la cancellazione dei file sorgente dopo il processing (issue 1.3)

Attualmente `_downloadFiles` cancella ogni file dallo storage remoto subito dopo il download. Se il processing fallisce, i file sono persi.

**Modificare `src/utils/s3.js`:**

Separare il download dalla cancellazione. `_downloadFiles` restituisce la lista dei file scaricati per la cancellazione successiva:

```js
const _downloadFiles = async (id, files, imgDir) => {
  await fs.promises.mkdir(imgDir, { recursive: true });

  const errors = [];
  const downloadedLocations = []; // traccia i file scaricati per cancellazione differita

  for (let i = 0; i < files.length; i++) {
    const file_name = files[i];
    const safeFileName = sanitizeFilename(file_name);
    if (!safeFileName) {
      console.warn(`Skipping invalid filename: ${file_name}`);
      continue;
    }
    const location = `${id}/images/${file_name}`;
    const localLocation = path.join(imgDir, safeFileName);

    console.log('Downloading', location);
    try {
      const get = await getObject(BUCKET, location);
      if (!get) {
        errors.push(`Empty response for ${location}`);
        continue;
      }
      await fs.promises.writeFile(localLocation, get);
      console.log('Downloaded and written', localLocation);
      // NON cancellare qui - traccia per cancellazione differita
      downloadedLocations.push(location);
    } catch (e) {
      console.error(`Error downloading ${location}:`, e.message);
      errors.push(`${location}: ${e.message}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Download errors: ${errors.join('; ')}`);
  }

  return downloadedLocations;
};

// Nuova funzione per cancellazione differita
const _cleanupRemoteFiles = async (locations) => {
  for (const location of locations) {
    try {
      await deleteObject(BUCKET, location);
    } catch (e) {
      console.warn(`Failed to delete remote file ${location}:`, e.message);
    }
  }
};
```

Esportare la nuova funzione:
```js
module.exports = {
  uploadDir: _uploadDir,
  downloadFiles: _downloadFiles,
  downloadFromTelegram: _downloadFromTelegram,
  cleanupRemoteFiles: _cleanupRemoteFiles,
};
```

**Modificare `src/ProcessManager.js`:**

Salvare le location dei file scaricati e cancellarli solo dopo il successo:

```js
async downloadProjectFiles() {
  // ... check locale invariato ...

  if (this.isTelegram) {
    await downloadFromTelegram(this.imgDir, files);
    this._remoteLocations = []; // Telegram non necessita cleanup
  } else {
    const locations = await downloadFiles(`${this.id}`, files, this.imgDir);
    this._remoteLocations = locations;
  }
}
```

Nella funzione `process()`, dopo `updateStatus('done')`:
```js
// Cleanup dei file remoti solo dopo successo completo
if (this._remoteLocations && this._remoteLocations.length > 0) {
  const { cleanupRemoteFiles } = require('./utils/s3');
  await cleanupRemoteFiles(this._remoteLocations);
}
```

**File da modificare:** `src/utils/s3.js`, `src/ProcessManager.js`

---

## Step 6 - Limite dimensione file (issue 1.5)

**Modificare `src/utils/s3.js`:**

Aggiungere una costante e un controllo in `_downloadFiles`:

```js
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB per file

// In _downloadFiles, dopo getObject:
const get = await getObject(BUCKET, location);
if (!get) { ... }
if (get.length > MAX_FILE_SIZE) {
  console.warn(`File ${location} exceeds size limit (${get.length} bytes), skipping`);
  continue;
}
```

Per Telegram, usare l'header Content-Length nella response prima del pipe:

```js
// In _downloadFromTelegram, nel loop delle responses:
const contentLength = parseInt(response.headers['content-length'] || '0', 10);
if (contentLength > MAX_FILE_SIZE) {
  console.warn(`Telegram file exceeds size limit: ${contentLength} bytes`);
  continue;
}
```

**File da modificare:** `src/utils/s3.js`

---

## Step 7 - Fix `requestHandler` S3 Client (issue 1.7)

**Installare la dipendenza:**

```bash
npm install @smithy/node-http-handler
```

**Modificare `src/lib/s3Client.js`:**

```js
// PRIMA
const https = require('https');
// ...
requestHandler: new https.Agent({ ... })

// DOPO
const { NodeHttpHandler } = require('@smithy/node-http-handler');
const https = require('https');
// ...
requestHandler: new NodeHttpHandler({
  connectionTimeout: 5000,
  socketTimeout: 60000,
  httpsAgent: new https.Agent({
    keepAlive: true,
    maxSockets: 50,
    rejectUnauthorized: true,
    minVersion: 'TLSv1.2'
  })
})
```

Rimuovere anche le opzioni `tls` duplicate dal livello superiore della config S3 (ora gestite dall'agent).

**File da modificare:** `src/lib/s3Client.js`

---

## Ordine di esecuzione consigliato

1. `npm install zod @smithy/node-http-handler`
2. Step 1 - `src/config.js` + rimozione dotenv da tutti i file
3. Step 2 - Validazione Zod in `db.js`
4. Step 3 - `execFile` in `ProcessManager.js`
5. Step 4 - SSRF fix in `s3.js`
6. Step 5 - Cancellazione differita in `s3.js` + `ProcessManager.js`
7. Step 6 - Limiti dimensione in `s3.js`
8. Step 7 - `requestHandler` in `s3Client.js`

## File impattati

| File | Step |
|------|------|
| `src/config.js` (NUOVO) | 1 |
| `src/lib/supabaseClient.js` | 1 |
| `src/lib/telegramClient.js` | 1 |
| `src/lib/s3Client.js` | 1, 7 |
| `src/utils/db.js` | 1, 2 |
| `src/utils/s3.js` | 1, 4, 5, 6 |
| `src/utils/telegram.js` | 1 |
| `src/ProcessManager.js` | 1, 3, 5 |
| `src/processQueue.js` | 1 |
