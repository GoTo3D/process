# Documentazione Tecnica - 3D Model Processing Service

## 1. Panoramica del Sistema

**config-3d-process** e' un servizio ibrido Node.js + Swift per la generazione di modelli 3D tramite fotogrammetria. Il servizio consuma job da una coda RabbitMQ, scarica immagini sorgente, le elabora usando l'API [Object Capture](https://developer.apple.com/documentation/realitykit/realitykit-object-capture/) di Apple RealityKit, e carica i risultati su storage cloud.

### Requisiti di Piattaforma

| Requisito | Valore |
|-----------|--------|
| Sistema operativo | macOS 14+ (Sonoma o successivo) |
| Architettura | arm64 (Apple Silicon) |
| Node.js | >= 22.0.0 |
| Swift | >= 6.0 (Xcode 16+) |
| Disco | >= 500MB liberi nella directory di lavoro |

> Il servizio e' vincolato a macOS perche' usa `PhotogrammetrySession` di RealityKit, disponibile esclusivamente su piattaforma Apple.

---

## 2. Architettura

### 2.1 Diagramma dei Componenti

```
                          +------------------+
                          |   RabbitMQ       |
                          |   (AMQP Queue)   |
                          +--------+---------+
                                   |
                          message (project ID)
                                   |
                          +--------v---------+
                          | processQueue.js  |  <-- Entry point
                          | (AMQP Consumer)  |
                          +--------+---------+
                                   |
                          +--------v---------+
                          | ProcessManager   |  <-- Orchestratore
                          +--------+---------+
                                   |
               +-------------------+-------------------+
               |                   |                   |
    +----------v------+  +--------v--------+  +-------v--------+
    | Supabase        |  | PhotoProcess    |  | Cloudflare R2  |
    | (DB + Storage)  |  | (Swift CLI)     |  | (S3-compatible)|
    +-----------------+  +---------+-------+  +----------------+
                                   |
                          +--------v---------+
                          |  RealityKit      |
                          |  Object Capture  |
                          |  (macOS API)     |
                          +------------------+
```

### 2.2 Flusso di Elaborazione

```
1. RICEZIONE     processQueue.js riceve un message AMQP con il project ID
                 Parsing: supporta sia numerico "123" che JSON {"id":123}
                 Prefetch: 1 (un job alla volta, elaborazione sequenziale)

2. INIZIALIZ.    ProcessManager.create(id) carica il progetto da Supabase
                 Imposta le directory: {BASE_DIR}/{id}/images, {BASE_DIR}/{id}/model
                 Rileva se la sorgente e' Telegram (campo telegram_user)

3. CONTROLLI     checkDiskSpace() verifica 500MB liberi
                 updateStatus('processing') con timestamp process_start

4. DOWNLOAD      Da Supabase Storage: downloadFiles() con p-limit(5)
                 Da Telegram: downloadFromTelegram() con validazione SSRF
                 I file sorgente NON vengono cancellati subito (cancellazione differita)

5. ELABORAZIONE  processAndConvert() invoca il binario PhotoProcess
                 Input: directory immagini + directory output
                 Output: model.usdz + file OBJ/MTL nella stessa directory
                 Timeout: 30 minuti con SIGTERM
                 Progress: JSON lines su stdout, parsato in tempo reale

6. UPLOAD        uploadToS3() scansiona ricorsivamente la directory output
                 Carica tutti i file trovati su R2 con p-limit(5)
                 Path S3: {projectId}/model/{filename}

7. NOTIFICA      Se Telegram: invia messaggio + file model.usdz all'utente

8. COMPLETAM.    updateStatus('done', {model_urls}) con timestamp process_end
                 Cancellazione differita dei file remoti (sorgente)
                 Cleanup locale: rimuove directory images/ e model/
```

### 2.3 Gestione Errori

```
Qualsiasi errore nel flusso:
    -> updateStatus('error') con process_end
    -> cleanupAll() rimuove file locali
    -> NON cancella i file sorgente remoti (preservati per retry)
    -> Errore propagato -> channel.nack() -> Dead Letter Queue
    -> Il messaggio non viene re-accodato (va nella DLQ per ispezione manuale)
```

---

## 3. Componenti Node.js

### 3.1 Entry Point: `src/processQueue.js`

Consumer AMQP con:
- **Reconnection**: backoff esponenziale fino a 10 tentativi (1s -> 30s)
- **Dead Letter Queue**: coda separata per messaggi falliti
- **Prefetch 1**: un solo job alla volta
- **Graceful shutdown**: intercetta SIGINT/SIGTERM con timeout 10s
- **Validazione**: schema Zod per i messaggi in coda

### 3.2 Orchestratore: `src/ProcessManager.js`

Classe principale che gestisce il ciclo di vita completo di un job:

| Metodo | Responsabilita' |
|--------|-----------------|
| `constructor(id, project)` | Inizializza path, rileva sorgente Telegram |
| `checkDiskSpace(500)` | Verifica spazio su disco via `statfs` |
| `updateStatus(status, data)` | Aggiorna stato progetto in Supabase |
| `downloadProjectFiles()` | Scarica immagini da Supabase o Telegram |
| `processAndConvert()` | Invoca PhotoProcess, parsa progress JSON |
| `uploadToS3()` | Carica risultati su Cloudflare R2 |
| `notifyTelegram()` | Invia notifica e file all'utente Telegram |
| `cleanupAll()` | Rimuove directory locali |
| `process()` | Orchestrazione completa del flusso |

**Sicurezza dei parametri:**

```javascript
const ALLOWED_DETAILS = ['preview', 'reduced', 'medium', 'full', 'raw', 'custom'];
const ALLOWED_ORDERINGS = ['unordered', 'sequential'];
const ALLOWED_FEATURES = ['normal', 'high'];
```

Tutti i parametri dal database vengono validati contro whitelist prima dell'invocazione del binario. Il binario e' invocato con `spawn()` (non `exec()`) e gli argomenti sono passati come array (nessuna shell interpolation).

### 3.3 Configurazione: `src/config.js`

Validazione centralizzata con Zod. Tutte le variabili d'ambiente sono validate all'avvio. Se la validazione fallisce, il processo termina immediatamente.

### 3.4 Servizi Esterni

| Servizio | Client | File |
|----------|--------|------|
| Supabase (DB) | `@supabase/supabase-js` | `src/lib/supabaseClient.js` |
| Supabase (Storage) | `@supabase/supabase-js` | `src/utils/s3.js` |
| Cloudflare R2 | `@aws-sdk/client-s3` | `src/lib/s3Client.js`, `src/lib/s3Api.js` |
| RabbitMQ | `amqplib` | `src/processQueue.js` |
| Telegram | `telegraf`, `undici` | `src/lib/telegramClient.js`, `src/utils/telegram.js` |

**Cloudflare R2 (S3-compatible)**:
- Endpoint: `https://{ACCOUNT_ID}.r2.cloudflarestorage.com`
- Path-style addressing (`forcePathStyle: true`)
- HTTPS con TLS 1.2+, keepAlive abilitato
- Retry: 3 tentativi con backoff esponenziale

---

## 4. Componente Swift: PhotoProcess

### 4.1 Architettura

PhotoProcess e' una CLI Swift che sostituisce i due binari precedenti (`HelloPhotogrammetry` + `usdconv`) con un singolo strumento piu' controllabile.

```
PhotoProcess/
├── Package.swift                      # Swift Package Manager
├── build.sh                           # Build + deploy in src/lib/
└── Sources/PhotoProcess/
    ├── PhotoProcess.swift             # @main, ArgumentParser CLI
    ├── SessionRunner.swift            # Orchestrazione PhotogrammetrySession
    ├── ProgressReporter.swift         # JSON stdout, debug stderr
    ├── DetailConfiguration.swift      # Mapping CLI -> Request.Detail
    ├── BoundsParser.swift             # Parsing bounding box
    └── OutputManager.swift            # Gestione directory e file output
```

### 4.2 API Apple Utilizzate

Il cuore di PhotoProcess e' [`PhotogrammetrySession`](https://developer.apple.com/documentation/realitykit/photogrammetrysession) di RealityKit:

- **Input**: directory di immagini (HEIC, JPG, PNG)
- **Output**: modello 3D in formato USDZ (file URL) o USDA/OBJ (directory URL)
- **Configurazione**: [`PhotogrammetrySession.Configuration`](https://developer.apple.com/documentation/realitykit/photogrammetrysession/configuration-swift.struct)
  - `sampleOrdering`: `.unordered` | `.sequential`
  - `featureSensitivity`: `.normal` | `.high`
  - `isObjectMaskingEnabled`: mascheramento automatico oggetto
  - `checkpointDirectory`: directory per checkpoint/resume
  - `customDetailSpecification`: parametri texture/mesh personalizzati

### 4.3 Livelli di Dettaglio

| Livello | Uso | Qualita' | Velocita' |
|---------|-----|----------|-----------|
| `preview` | Anteprima rapida | Bassa | Molto veloce |
| `reduced` | Trasmissione rete | Media-bassa | Veloce |
| `medium` | Uso generale (default) | Media | Moderata |
| `full` | Massima qualita' interattiva | Alta | Lenta |
| `raw` | Post-produzione professionale | Massima | Molto lenta |
| `custom` | Personalizzato | Configurabile | Variabile |

**Dettaglio custom** ([`CustomDetailSpecification`](https://developer.apple.com/documentation/realitykit/photogrammetrysession/configuration-swift.struct/customdetailspecification)):

| Parametro CLI | Tipo API | Valori |
|--------------|----------|--------|
| `--max-polygons` | `maximumPolygonCount: UInt` | Qualsiasi intero positivo |
| `--texture-dimension` | `TextureDimension` enum | `.oneK` `.twoK` `.fourK` `.eightK` `.sixteenK`* |
| `--texture-format` | `TextureFormat` enum | `.png` `.jpeg(compressionQuality:)` |
| `--texture-maps` | `TextureMapOutputs` OptionSet | `.diffuseColor` `.normal` `.roughness` `.displacement` `.ambientOcclusion` `.all` |

> *`.sixteenK` richiede macOS 15+

### 4.4 Strategia Output Duale (USDZ + OBJ)

PhotoProcess genera entrambi i formati in una singola esecuzione:

1. **Sessione USDZ**: `PhotogrammetrySession.Request.modelFile(url: model.usdz)` genera il file USDZ
2. **Sessione OBJ**: `PhotogrammetrySession.Request.modelFile(url: obj/)` con URL directory genera USDA/OBJ/textures
3. **Flatten**: i file dalla sotto-directory `obj/` vengono spostati nella directory base
4. **Risultato**: tutti i file finiscono nella stessa directory, pronti per l'upload

Nota: vengono create due sessioni separate per USDZ e OBJ per evitare ambiguita' nel tracking dei progress events.

### 4.5 Protocollo Progress JSON

Ogni evento e' una riga JSON su stdout. Il ProcessManager Node.js parsa queste righe in tempo reale.

**Schema eventi:**

```json
// Progresso elaborazione
{"type":"progress","request":"usdz","fraction":0.42,"stage":"meshGeneration","eta_seconds":120.5}

// Completamento richiesta
{"type":"complete","request":"usdz","output_path":"/path/to/model.usdz"}

// Errore
{"type":"error","request":"obj","message":"Insufficient storage"}

// Campione invalido
{"type":"invalid_sample","sample_id":3,"reason":"Image too blurry"}

// Campione saltato
{"type":"skipped_sample","sample_id":7}

// Downsampling automatico
{"type":"downsampling","message":"Automatic downsampling applied"}

// Stitching incompleto
{"type":"stitching_incomplete","message":"Not all images could be stitched"}

// Elaborazione completata
{"type":"processing_complete"}

// Elaborazione cancellata (SIGTERM/SIGINT)
{"type":"cancelled"}
```

**Stages** (da [`ProcessingStage`](https://developer.apple.com/documentation/realitykit/photogrammetrysession/output/processingstage)):

`preProcessing` -> `imageAlignment` -> `pointCloudGeneration` -> `meshGeneration` -> `textureMapping` -> `optimization`

### 4.6 Gestione Segnali

PhotoProcess intercetta:
- **SIGTERM**: inviato dal timeout di 30 minuti di ProcessManager -> `session.cancel()` -> evento `cancelled`
- **SIGINT**: Ctrl+C in esecuzione manuale -> `session.cancel()` -> evento `cancelled`

La cancellazione e' graceful: la sessione emette `.processingCancelled` prima di terminare.

---

## 5. Infrastruttura e Deploy

### 5.1 Struttura Directory del Progetto

```
process/
├── src/
│   ├── processQueue.js          # Entry point AMQP consumer
│   ├── ProcessManager.js        # Orchestratore principale
│   ├── config.js                # Configurazione Zod
│   ├── lib/
│   │   ├── PhotoProcess         # Binario Swift compilato (arm64)
│   │   ├── supabaseClient.js    # Client Supabase
│   │   ├── telegramClient.js    # Client Telegram
│   │   ├── s3Client.js          # Client AWS SDK per R2
│   │   └── s3Api.js             # Operazioni S3 con retry
│   └── utils/
│       ├── s3.js                # Upload/download/cleanup
│       ├── db.js                # Operazioni database Supabase
│       └── telegram.js          # Invio notifiche Telegram
├── PhotoProcess/                # Sorgente Swift CLI
│   ├── Package.swift
│   ├── build.sh
│   └── Sources/PhotoProcess/    # 6 file Swift
├── test/
│   ├── unit/                    # 7 file di test unitari (~195 casi)
│   ├── integration/             # 2 test di integrazione
│   ├── e2e/                     # 1 test end-to-end
│   └── helpers/                 # Utility di test
├── plans/                       # Documenti di analisi e pianificazione
├── docs/                        # Documentazione tecnica
├── ecosystem.config.js          # Configurazione PM2
├── package.json                 # Node.js manifest
└── .env.example                 # Template variabili d'ambiente
```

### 5.2 Storage Locale

```
/Volumes/T7/projects/            # Directory di lavoro (configurabile via PROJECTS_BASE_DIR)
├── {projectId}/
│   ├── images/                  # Immagini scaricate (cancellate dopo upload)
│   │   ├── photo1.jpg
│   │   ├── photo2.heic
│   │   └── ...
│   └── model/                   # Output PhotoProcess (cancellato dopo upload)
│       ├── model.usdz           # Modello USDZ
│       ├── model.obj            # Mesh OBJ (dopo flatten)
│       ├── model.mtl            # Materiali MTL
│       └── *.png/jpg            # Texture
└── ...
```

### 5.3 PM2 (Process Manager)

```javascript
// ecosystem.config.js
{
  name: "PROCESS",
  script: "./src/processQueue.js",
  instances: 1,           // AMQP single consumer
  max_memory_restart: "500M",
  max_restarts: 10,
  log_date_format: "YYYY-MM-DD HH:mm:ss",
  error_file: "./logs/error.log",
  out_file: "./logs/out.log"
}
```

### 5.4 Build e Deploy del Binario Swift

```bash
# Build release
cd PhotoProcess && swift build -c release

# Deploy (script automatizzato)
bash PhotoProcess/build.sh
# -> Compila in release
# -> Copia .build/release/PhotoProcess in src/lib/PhotoProcess
# -> Imposta permessi esecuzione
```

Il binario risultante (~1.7MB) e' un eseguibile arm64 nativo. Non richiede runtime Swift installato separatamente.

---

## 6. Schema Database (Supabase)

### Tabella `project`

| Colonna | Tipo | Descrizione |
|---------|------|-------------|
| `id` | integer | Primary key |
| `status` | string | `processing` / `done` / `error` |
| `files` | string[] | Lista nomi file immagini sorgente |
| `detail` | string | Livello di dettaglio (preview/reduced/medium/full/raw/custom) |
| `feature` | string | Feature sensitivity (normal/high) |
| `order` | string | Sample ordering (unordered/sequential) |
| `process_start` | timestamp | Inizio elaborazione |
| `process_end` | timestamp | Fine elaborazione |
| `model_urls` | string[] | URL file modello su R2 |
| `telegram_user` | integer | Riferimento utente Telegram (nullable) |

### Tabella `telegram_user`

| Colonna | Tipo | Descrizione |
|---------|------|-------------|
| `id` | integer | Primary key |
| `user_id` | string/number | ID utente Telegram |

### Transizioni di Stato

```
[nuovo] -> processing (process_start impostato)
processing -> done (process_end + model_urls impostati)
processing -> error (process_end impostato)
```

---

## 7. Variabili d'Ambiente

| Variabile | Descrizione | Default |
|-----------|-------------|---------|
| `SUPABASE_URL` | URL istanza Supabase | (richiesto) |
| `SUPABASE_KEY` | Chiave anon Supabase | (richiesto) |
| `BOT_TOKEN` | Token bot Telegram | (richiesto) |
| `CLOUDFLARE_R2_ACCOUNT_ID` | Account ID Cloudflare | (richiesto) |
| `CLOUDFLARE_R2_ACCESS_KEY_ID` | Access key R2 | (richiesto) |
| `CLOUDFLARE_R2_SECRET_ACCESS_KEY` | Secret key R2 | (richiesto) |
| `QUEUE_CONNECTION_STRING` | URL connessione AMQP | (richiesto) |
| `QUEUE` | Nome coda | `processing-dev` |
| `BUCKET` | Nome bucket R2 | (richiesto) |
| `PROJECTS_BASE_DIR` | Directory lavoro locale | `/Volumes/T7/projects` |

---

## 8. Metriche e Soglie

| Parametro | Valore | Note |
|-----------|--------|------|
| Timeout fotogrammetria | 30 minuti | SIGTERM al processo |
| Spazio disco minimo | 500 MB | Controllato prima di ogni job |
| Dimensione max file | 100 MB | Per singolo file in download |
| Upload concorrenti | 5 | `p-limit(5)` |
| Download concorrenti | 5 | `p-limit(5)` |
| Retry connessione AMQP | 10 tentativi | Backoff 1s -> 30s |
| Retry operazioni S3 | 3 tentativi | Backoff 2s -> 8s |
| Prefetch AMQP | 1 | Un job alla volta |
| Max memoria PM2 | 500 MB | Restart automatico se superata |
| Max restart PM2 | 10 | Dopo 10 restart il processo si ferma |
| Graceful shutdown | 10 secondi | Force exit dopo timeout |

---

## 9. Comandi

### Sviluppo e Produzione

```bash
npm run dev              # Avvia consumer con .env (sviluppo)
npm start                # Avvia consumer (produzione, NODE_ENV)
pm2 start ecosystem.config.js --env production  # Avvio con PM2
```

### Testing

```bash
npm test                 # Unit test (Node.js built-in test runner)
npm run test:unit        # Solo unit test
npm run test:local       # Test locale senza servizi esterni
npm run test:integration # Test con servizi reali
npm run test:e2e         # Test end-to-end completo
```

### Build Swift

```bash
bash PhotoProcess/build.sh                    # Build + deploy
cd PhotoProcess && swift build                # Solo build debug
cd PhotoProcess && swift build -c release     # Solo build release
```

### PhotoProcess CLI

```bash
# Uso base
PhotoProcess <input-dir> <output-dir> --detail medium

# Preview veloce
PhotoProcess /images /output --detail preview --skip-obj

# Qualita' massima con texture custom
PhotoProcess /images /output --detail custom \
  --max-polygons 500000 --texture-dimension 8k \
  --texture-format png --texture-maps diffuse,normal,roughness

# Con bounding box
PhotoProcess /images /output --detail full \
  --bounds "-0.5,-0.5,-0.5,0.5,0.5,0.5"

# Con checkpoint per ripresa
PhotoProcess /images /output --detail full \
  --checkpoint-directory /checkpoints
```

---

## 10. Sicurezza

### Misure Implementate

| Rischio | Mitigazione | File |
|---------|-------------|------|
| Command Injection | Whitelist parametri + `spawn()` con array args | `ProcessManager.js:10-26` |
| SSRF (Telegram) | Validazione hostname esatta contro whitelist | `s3.js:36-46` |
| Path Traversal | `sanitizeFilename()` con `path.basename()` | `s3.js:26-29` |
| File size abuse | Limite 100MB per file | `s3.js:12-13` |
| Credential exposure | Validazione Zod all'avvio, `.env` in `.gitignore` | `config.js` |
| Resource exhaustion | Disk space check, timeout, p-limit concorrenza | `ProcessManager.js` |

---

## 11. Dipendenze

### Node.js

| Pacchetto | Versione | Uso |
|-----------|----------|-----|
| `@aws-sdk/client-s3` | ^3.616.0 | Client S3 per Cloudflare R2 |
| `@smithy/node-http-handler` | ^4.4.12 | HTTP handler con keepAlive per S3 |
| `@supabase/supabase-js` | ^2.43.2 | Client Supabase (DB + Storage) |
| `amqplib` | ^0.10.3 | Client RabbitMQ/AMQP |
| `dotenv` | ^16.3.1 | Caricamento variabili d'ambiente |
| `mime-types` | ^2.1.35 | Rilevamento MIME type per upload |
| `p-limit` | ^3.1.0 | Limitazione concorrenza |
| `telegraf` | ^4.16.3 | Bot Telegram |
| `undici` | ^6.10.1 | HTTP client per download Telegram |
| `zod` | ^4.3.6 | Validazione schema runtime |

### Swift

| Pacchetto | Versione | Uso |
|-----------|----------|-----|
| `swift-argument-parser` | >= 1.5.0 | Parsing argomenti CLI |
| RealityKit (framework) | macOS 14+ | PhotogrammetrySession API |

---

## 12. Documenti Storici

La directory `plans/` contiene documenti di analisi precedenti alla migrazione a PhotoProcess:

| Documento | Contenuto | Stato |
|-----------|-----------|-------|
| `ANALISI_CODEBASE.md` | Analisi di sicurezza, best practices e performance | Storico (pre-migrazione) |
| `PIANO_SICUREZZA.md` | Piano di implementazione sicurezza (7 step) | Implementato |
| `PIANO_BEST_PRACTICES.md` | Piano best practices (10 step) | Implementato |
| `PIANO_PERFORMANCE.md` | Piano ottimizzazione performance (8 step) | Implementato |

> Nota: Questi documenti fanno riferimento a `HelloPhotogrammetry` e `usdconv`, i binari precedenti ora sostituiti da `PhotoProcess`.

---

## 13. Riferimenti

- [Apple Object Capture Documentation](https://developer.apple.com/documentation/realitykit/realitykit-object-capture/)
- [PhotogrammetrySession API Reference](https://developer.apple.com/documentation/realitykit/photogrammetrysession)
- [PhotogrammetrySession.Configuration](https://developer.apple.com/documentation/realitykit/photogrammetrysession/configuration-swift.struct)
- [Creating a Photogrammetry Command-Line App](https://developer.apple.com/documentation/realitykit/creating-a-photogrammetry-command-line-app)
- [WWDC21: Create 3D models with Object Capture](https://developer.apple.com/videos/play/wwdc2021/10076/)
- [WWDC24: Discover area mode for Object Capture](https://developer.apple.com/videos/play/wwdc2024/10107/)
- [CustomDetailSpecification](https://developer.apple.com/documentation/realitykit/photogrammetrysession/configuration-swift.struct/customdetailspecification)
- [swift-argument-parser](https://github.com/apple/swift-argument-parser)
