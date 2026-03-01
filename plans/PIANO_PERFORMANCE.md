# Piano Implementazione - Performance

Questo piano copre tutte le ottimizzazioni di performance identificate nell'analisi.

---

## Prerequisito: Installare p-limit

```bash
npm install p-limit
```

`p-limit` e' una libreria minimale per limitare la concorrenza delle Promise.

---

## Step 1 - Upload parallelo dei file del modello (issue 3.1)

Attualmente i file vengono caricati su R2 uno alla volta. Con upload parallelo (concorrenza limitata) si puo' ridurre drasticamente il tempo di upload.

**Modificare `src/utils/s3.js`, funzione `_uploadDir`:**

```js
const pLimit = require('p-limit');

const _uploadDir = async ({ file_location, bucket_location }) => {
  const files = await walk(file_location);
  console.log('Uploading files:', files.length);

  const limit = pLimit(5); // max 5 upload paralleli

  const uploads = files.map((fileInfo) =>
    limit(async () => {
      const data = await fs.promises.readFile(fileInfo.filepath);
      const location = `${bucket_location}/model/${fileInfo.filename}`;
      console.log('Uploading file:', fileInfo.filename);
      await putObject(BUCKET, location, data);
      return location;
    })
  );

  return Promise.all(uploads);
};
```

Questo step dipende anche dalla modifica di `walk()` (Step 3), che deve restituire `filepath` invece di `file: readFile(...)`.

**File da modificare:** `src/utils/s3.js`

---

## Step 2 - Download parallelo dei file sorgente (issue 3.2)

Attualmente i file vengono scaricati da R2 uno alla volta. Con download parallelo si riduce il tempo di preparazione.

**Modificare `src/utils/s3.js`, funzione `_downloadFiles`:**

```js
const pLimit = require('p-limit');

const _downloadFiles = async (id, files, imgDir) => {
  await fs.promises.mkdir(imgDir, { recursive: true });

  const limit = pLimit(5); // max 5 download paralleli
  const errors = [];
  const downloadedLocations = [];

  const tasks = files.map((file_name) =>
    limit(async () => {
      const safeFileName = sanitizeFilename(file_name);
      if (!safeFileName) {
        console.warn(`Skipping invalid filename: ${file_name}`);
        return;
      }

      const location = `${id}/images/${file_name}`;
      const localLocation = path.join(imgDir, safeFileName);

      console.log('Downloading', location);
      try {
        const get = await getObject(BUCKET, location);
        if (!get) {
          errors.push(`Empty response for ${location}`);
          return;
        }
        await fs.promises.writeFile(localLocation, get);
        console.log('Downloaded', localLocation);
        downloadedLocations.push(location);
      } catch (e) {
        console.error(`Error downloading ${location}:`, e.message);
        errors.push(`${location}: ${e.message}`);
      }
    })
  );

  await Promise.all(tasks);

  if (errors.length > 0) {
    throw new Error(`Download errors: ${errors.join('; ')}`);
  }

  return downloadedLocations;
};
```

**File da modificare:** `src/utils/s3.js`

---

## Step 3 - `walk()` lazy: non leggere i file durante la scansione (issue 3.3)

Attualmente `walk()` chiama `readFile()` su ogni file durante la scansione della directory, creando Promise<Buffer> per tutti i file simultaneamente. Questo causa picchi di memoria inutili.

**Modificare `src/utils/s3.js`, funzione `walk`:**

```js
// PRIMA
const walk = async (currentDirPath) => {
  const ret = [];
  const files = await readdir(currentDirPath);
  for (const file of files) {
    const filepath = path.join(currentDirPath, file);
    const _stat = await stat(filepath);
    const _path = path.extname(file);
    if (_stat.isFile())
      ret.push({
        file: readFile(filepath),  // <-- lettura immediata!
        filename: file,
        contentType: mime.lookup(_path),
        path: filepath.substring(currentDirPath.length + 1),
      });
    else if (_stat.isDirectory()) ret.push(...(await walk(filepath)));
  }
  return ret;
};

// DOPO
const walk = async (currentDirPath) => {
  const ret = [];
  const files = await readdir(currentDirPath);
  for (const file of files) {
    const filepath = path.join(currentDirPath, file);
    const _stat = await stat(filepath);
    if (_stat.isFile()) {
      ret.push({
        filepath,              // <-- salva solo il path
        filename: file,
        contentType: mime.lookup(path.extname(file)),
      });
    } else if (_stat.isDirectory()) {
      ret.push(...(await walk(filepath)));
    }
  }
  return ret;
};
```

Dopo questa modifica, `_uploadDir` (Step 1) deve leggere il file al momento dell'upload.

**File da modificare:** `src/utils/s3.js`

---

## Step 4 - Concorrenza limitata per download Telegram (issue 3.4)

**Modificare `src/utils/s3.js`, funzione `_downloadFromTelegram`:**

```js
const _downloadFromTelegram = async (file_location, imgs) => {
  const validUrls = imgs.filter((img) => {
    if (!isValidTelegramUrl(img)) {
      console.warn(`Skipping invalid/untrusted URL: ${img}`);
      return false;
    }
    return true;
  });

  if (validUrls.length === 0) {
    throw new Error('No valid Telegram URLs to download');
  }

  await fs.promises.mkdir(file_location, { recursive: true });

  const limit = pLimit(5); // max 5 download paralleli

  const tasks = validUrls.map((url) =>
    limit(async () => {
      const rawFilename = url.split('/').pop();
      const filename = sanitizeFilename(rawFilename);
      if (!filename) {
        console.warn(`Skipping invalid filename from URL: ${url}`);
        return;
      }

      const response = await request(url);
      const filePath = path.join(file_location, filename);
      const fileStream = fs.createWriteStream(filePath);

      await new Promise((resolve, reject) => {
        response.body.pipe(fileStream);
        fileStream.on('finish', resolve);
        fileStream.on('error', reject);
      });

      console.log('Downloaded', filename);
    })
  );

  await Promise.all(tasks);
};
```

**File da modificare:** `src/utils/s3.js`

---

## Step 5 - Usare `spawn` con streaming per la fotogrammetria (issue 3.5)

Questo step si integra con il fix sicurezza (execFile). Se si vuole anche ottimizzare l'uso della memoria per lo stdout, usare `spawn` con streaming.

**Modificare `src/ProcessManager.js`, metodo `processModel()`:**

```js
const { spawn } = require('child_process');

async processModel() {
  const detail = sanitizeParam(this.project.detail, ALLOWED_DETAILS, 'medium');
  const ordering = sanitizeParam(this.project.order, ALLOWED_ORDERINGS, 'unordered');
  const feature = sanitizeParam(this.project.feature, ALLOWED_FEATURES, 'normal');

  const bin = path.join(libDir, 'HelloPhotogrammetry');
  const outputPath = path.join(this.outDir, 'model.usdz');
  const args = [this.imgDir, outputPath, '-d', detail, '-o', ordering, '-f', feature];

  console.log(`Executing: ${bin} ${args.join(' ')}`);

  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Streaming stdout/stderr invece di accumulare in memoria
    child.stdout.on('data', (data) => {
      // Log solo l'ultima riga per ridurre il rumore
      const lines = data.toString().trim().split('\n');
      console.log(`[photogrammetry] ${lines[lines.length - 1]}`);
    });

    child.stderr.on('data', (data) => {
      console.error(`[photogrammetry:err] ${data.toString().trim()}`);
    });

    // Timeout manuale (spawn non ha opzione timeout built-in)
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Process killed due to timeout (${PHOTOGRAMMETRY_TIMEOUT}ms)`));
    }, PHOTOGRAMMETRY_TIMEOUT);

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`HelloPhotogrammetry exited with code ${code}`));
        return;
      }
      fs.promises
        .access(outputPath)
        .then(() => resolve('ok'))
        .catch(() => reject(new Error('Output file not found')));
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}
```

Fare lo stesso per `convertModel()`:

```js
async convertModel() {
  const bin = path.join(libDir, 'usdconv');
  const inputPath = path.join(this.outDir, 'model.usdz');

  return new Promise((resolve, reject) => {
    const child = spawn(bin, [inputPath]);

    child.stdout.on('data', (data) => {
      console.log(`[usdconv] ${data.toString().trim()}`);
    });

    child.stderr.on('data', (data) => {
      console.error(`[usdconv:err] ${data.toString().trim()}`);
    });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Conversion killed due to timeout (${CONVERSION_TIMEOUT}ms)`));
    }, CONVERSION_TIMEOUT);

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`usdconv exited with code ${code}`));
        return;
      }
      resolve('ok');
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}
```

**File da modificare:** `src/ProcessManager.js`

---

## Step 6 - Usare `transformToByteArray` dell'SDK v3 (issue 3.6)

**Modificare `src/lib/s3Api.js`, funzione `getObject`:**

```js
// PRIMA
const response = await clientS3.send(new GetObjectCommand({ Bucket, Key }));
const chunks = [];
const stream = response.Body;
return new Promise((resolve, reject) => {
  stream.on('data', (chunk) => chunks.push(chunk));
  stream.on('end', () => resolve(Buffer.concat(chunks)));
  stream.on('error', (err) => reject(err));
});

// DOPO
const response = await clientS3.send(new GetObjectCommand({ Bucket, Key }));
return Buffer.from(await response.Body.transformToByteArray());
```

Questo semplifica il codice e usa il metodo ottimizzato dell'SDK.

**File da modificare:** `src/lib/s3Api.js`

---

## Step 7 - Controllo spazio disco prima del processing (issue 3.7)

**Aggiungere in `src/ProcessManager.js`:**

```js
const { statfs } = require('fs/promises');

async checkDiskSpace(requiredMB = 500) {
  try {
    const stats = await statfs(config.PROJECTS_BASE_DIR);
    const availableMB = (stats.bavail * stats.bsize) / (1024 * 1024);
    if (availableMB < requiredMB) {
      throw new Error(
        `Insufficient disk space: ${Math.round(availableMB)}MB available, ${requiredMB}MB required`
      );
    }
    console.log(`Disk space OK: ${Math.round(availableMB)}MB available`);
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.warn(`Base directory ${config.PROJECTS_BASE_DIR} not found, skipping disk check`);
      return;
    }
    throw err;
  }
}
```

Chiamarlo nel metodo `process()`, prima di creare le directory:

```js
async process() {
  try {
    // Check disk space before starting
    await this.checkDiskSpace();
    // ... resto del codice
  }
}
```

**File da modificare:** `src/ProcessManager.js`

---

## Step 8 - Cleanup completo dei file temporanei (issue 3.8)

Dopo l'upload su S3, cancellare anche la directory `outDir` con i file del modello.

**Modificare `src/ProcessManager.js`:**

Aggiungere un metodo per il cleanup completo:

```js
async cleanupAll() {
  // Cancella sia le immagini (se esistono ancora) che il modello
  const dirs = [this.imgDir, this.outDir];
  for (const dir of dirs) {
    try {
      await fs.promises.rm(dir, { recursive: true, force: true });
      console.log(`Cleaned up: ${dir}`);
    } catch (e) {
      console.warn(`Failed to cleanup ${dir}:`, e.message);
    }
  }
}
```

Chiamare `cleanupAll()` alla fine del metodo `process()`, sia in caso di successo che nel blocco catch (per evitare di lasciare file orfani):

```js
async process() {
  try {
    // ... tutto il processing ...

    await this.updateStatus('done', { model_urls });

    // Cleanup completo dopo successo
    await this.cleanupAll();
  } catch (error) {
    console.error(`Error processing ${this.id}:`, error);
    await this.updateStatus('error');
    // Cleanup anche in caso di errore (le immagini sono ancora su storage remoto se si usa cancellazione differita)
    await this.cleanupAll();
    throw error;
  }
}
```

Rimuovere il metodo `cleanupImages()` separato e la sua chiamata nel mezzo del pipeline, dato che ora il cleanup e' alla fine.

**File da modificare:** `src/ProcessManager.js`

---

## Ordine di esecuzione consigliato

1. `npm install p-limit`
2. Step 3 - Rendere `walk()` lazy (prerequisito per Step 1)
3. Step 1 - Upload parallelo
4. Step 2 - Download parallelo da R2
5. Step 4 - Download parallelo da Telegram
6. Step 5 - `spawn` con streaming per fotogrammetria
7. Step 6 - `transformToByteArray` in s3Api
8. Step 7 - Controllo spazio disco
9. Step 8 - Cleanup completo

## File impattati

| File | Step |
|------|------|
| `src/utils/s3.js` | 1, 2, 3, 4 |
| `src/ProcessManager.js` | 5, 7, 8 |
| `src/lib/s3Api.js` | 6 |
| `package.json` | (aggiunta p-limit) |

## Note

- Gli Step 1-4 possono essere implementati insieme dato che impattano lo stesso file (`s3.js`)
- Lo Step 5 (spawn) e' alternativo al fix sicurezza con `execFile`: scegliere `spawn` e' la soluzione migliore perche' risolve sia il problema di sicurezza che di performance
- Il valore di concorrenza (5) e' un buon default ma puo' essere reso configurabile via env var per tuning
