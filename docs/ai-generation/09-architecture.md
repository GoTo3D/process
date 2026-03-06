# 09 - Architettura di Integrazione: Generazione AI

## 1. Panoramica

Questo documento descrive l'architettura per estendere il servizio di processing 3D esistente con la generazione di modelli 3D basata su intelligenza artificiale. L'obiettivo e' affiancare alla pipeline di fotogrammetria (che utilizza `PhotoProcess` e l'API Object Capture di Apple) una nuova pipeline che sfrutta provider AI, sia cloud (Tripo, Meshy, Rodin) che self-hosted (TripoSR, SPAR3D, Shap-E, InstantMesh).

Il sistema attuale elabora immagini in modelli 3D tramite fotogrammetria. Con questa estensione, sara' possibile generare modelli 3D anche a partire da una singola immagine o da un prompt testuale, delegando la generazione a un provider AI selezionabile per ogni job.

La retrocompatibilita' con i messaggi esistenti in coda e' garantita: i messaggi nel formato attuale (`"123"` o `{"id": 123}`) continueranno a essere instradati alla pipeline di fotogrammetria senza alcuna modifica.

Sono disponibili due approcci di orchestrazione per i modelli AI:
- **Integrazione diretta** (AIProcessManager): ogni provider ha un adapter Node.js dedicato
- **ComfyUI come backend** (ComfyUIProcessManager): server unificato con nodi per ogni modello (vedi `11-comfyui-pipeline.md`)

---

## 2. Architettura Estesa

### 2.1 Diagramma dei Componenti

```
                          +------------------+
                          |   RabbitMQ       |
                          |   (AMQP Queue)   |
                          +--------+---------+
                                   |
                          message (project ID + metadata)
                                   |
                          +--------v---------+
                          | processQueue.js  |  <-- Entry point (src/processQueue.js)
                          | (AMQP Consumer)  |
                          +--------+---------+
                                   |
                          +--------v---------+
                          |     Router       |  <-- Instradamento per tipo
                          | (basato su type) |
                          +--------+---------+
                                   |
                  +----------------+----------------+
                  |                                 |
       type: "photogrammetry"              type: "ai"
       (o messaggio legacy)                (nuovo formato)
                  |                                 |
       +----------v----------+           +----------v----------+
       |  ProcessManager     |           |  AIProcessManager   |
       |  (src/ProcessManager |           |  (src/AIProcess     |
       |       .js)          |           |      Manager.js)    |
       +----------+----------+           +----------+----------+
                  |                                 |
       +----------v----------+          +-----------+-----------+
       |  PhotoProcess       |          |                       |
       |  (Swift CLI)        |          |    AIProvider         |
       |  RealityKit Object  |          |    (Strategy)         |
       |  Capture            |          |                       |
       +---------------------+          +-----+----------+------+
                                              |          |
                                    +---------+--+  +----+----------+
                                    | Cloud API  |  | Self-hosted   |
                                    | Providers  |  | Models        |
                                    +------------+  +---------------+
                                    | - Tripo    |  | - TripoSR     |
                                    | - Meshy    |  | - SPAR3D      |
                                    | - Rodin    |  | - Shap-E      |
                                    +------------+  | - InstantMesh |
                                                    | - Hunyuan3D   |
                                                    +-------+-------+
                                                            |
                                                    (alternativa)
                                                            |
                                                    +-------v-------+
                                                    | ComfyUI       |
                                                    | Server (8188) |
                                                    | Nodi 3D       |
                                                    +---------------+
```

### 2.2 Flusso Decisionale del Router

```
Messaggio ricevuto dalla coda
         |
         v
  parseQueueMessage(content)
         |
         v
  Il messaggio ha campo "type"?
         |
    +----+----+
    |         |
   NO        SI
    |         |
    v         v
 FOTOGRAMM.  type === "ai"?
 (legacy)         |
              +---+---+
              |       |
             SI      NO
              |       |
              v       v
         AI PIPELINE  FOTOGRAMM.
                      (esplicito)
```

---

## 3. Estensione Schema Messaggi Coda

### 3.1 Schema Attuale

Lo schema attuale in `src/processQueue.js:14-17` supporta due formati:

```javascript
// src/processQueue.js - Schema attuale
const QueueMessageSchema = z.union([
  z.string().regex(/^\d+$/).transform(Number),
  z.object({ id: z.number().int().positive() }).transform(obj => obj.id),
]);
```

Questo produce sempre un semplice `number` (il project ID).

### 3.2 Schema Esteso

Il nuovo schema deve mantenere la retrocompatibilita' e aggiungere il supporto per i messaggi AI:

```javascript
// Sotto-schema per messaggi AI
const AIMessageSchema = z.object({
  id: z.number().int().positive(),
  type: z.literal('ai'),
  provider: z.enum([
    // Cloud providers
    'tripo', 'meshy', 'rodin',
    // Self-hosted models
    'triposr', 'spar3d', 'shap-e', 'instantmesh', 'hunyuan3d'
  ]),
  input_type: z.enum(['image', 'text']),
  prompt: z.string().optional(),     // obbligatorio se input_type === 'text'
  ai_options: z.object({
    quality: z.enum(['draft', 'standard', 'high']).default('standard'),
    output_format: z.enum(['glb', 'obj', 'fbx', 'usdz']).default('glb'),
    texture_resolution: z.enum(['512', '1024', '2048', '4096']).default('1024'),
    seed: z.number().int().optional(),
  }).optional(),
});

// Sotto-schema per messaggi fotogrammetria espliciti
const PhotogrammetryMessageSchema = z.object({
  id: z.number().int().positive(),
  type: z.literal('photogrammetry').optional(),
});

// Schema unificato con retrocompatibilita'
const QueueMessageSchema = z.union([
  // Legacy: stringa numerica "123"
  z.string().regex(/^\d+$/).transform(Number)
    .transform(id => ({ id, type: 'photogrammetry' })),

  // AI: oggetto con type "ai"
  AIMessageSchema,

  // Fotogrammetria: oggetto con type esplicito o assente
  PhotogrammetryMessageSchema
    .transform(obj => ({ id: obj.id, type: 'photogrammetry' })),
]);
```

### 3.3 Esempi di Messaggi

| Formato | Esempio | Pipeline |
|---------|---------|----------|
| Stringa numerica (legacy) | `"123"` | Fotogrammetria |
| Oggetto semplice (legacy) | `{"id": 123}` | Fotogrammetria |
| Oggetto esplicito | `{"id": 123, "type": "photogrammetry"}` | Fotogrammetria |
| AI da immagine | `{"id": 456, "type": "ai", "provider": "tripo", "input_type": "image"}` | AI |
| AI da testo | `{"id": 789, "type": "ai", "provider": "meshy", "input_type": "text", "prompt": "a medieval castle"}` | AI |
| AI con opzioni | `{"id": 101, "type": "ai", "provider": "triposr", "input_type": "image", "ai_options": {"quality": "high"}}` | AI |

> Nota: lo schema `ProjectSchema` in `src/utils/db.js:4-27` usa `.passthrough()`, quindi i nuovi campi nel database non causeranno errori di validazione nel codice esistente.

---

## 4. Estensione Schema Database

### 4.1 Nuovi Campi per la Tabella `project`

I campi esistenti (definiti in `src/utils/db.js:4-27`) rimangono invariati. Si aggiungono i seguenti campi:

| Colonna | Tipo | Default | Descrizione |
|---------|------|---------|-------------|
| `generation_type` | `text` | `'photogrammetry'` | Tipo di generazione: `photogrammetry` o `ai` |
| `ai_provider` | `text` | `NULL` | Provider AI utilizzato (es. `tripo`, `meshy`, `triposr`) |
| `ai_input_type` | `text` | `NULL` | Tipo di input AI: `image` o `text` |
| `ai_prompt` | `text` | `NULL` | Prompt testuale per generazione text-to-3D |
| `ai_task_id` | `text` | `NULL` | ID del task esterno (per provider cloud con polling) |

### 4.2 Migrazione SQL

```sql
-- Migrazione: aggiunta supporto generazione AI alla tabella project
-- Retrocompatibile: tutti i campi sono nullable o hanno default

ALTER TABLE project
  ADD COLUMN generation_type text NOT NULL DEFAULT 'photogrammetry'
    CHECK (generation_type IN ('photogrammetry', 'ai'));

ALTER TABLE project
  ADD COLUMN ai_provider text
    CHECK (ai_provider IN (
      'tripo', 'meshy', 'rodin',
      'triposr', 'spar3d', 'shap-e', 'instantmesh', 'hunyuan3d', 'hunyuan3d'
    ) OR ai_provider IS NULL);

ALTER TABLE project
  ADD COLUMN ai_input_type text
    CHECK (ai_input_type IN ('image', 'text') OR ai_input_type IS NULL);

ALTER TABLE project
  ADD COLUMN ai_prompt text;

ALTER TABLE project
  ADD COLUMN ai_task_id text;

-- Vincolo: i campi AI devono essere valorizzati solo per generation_type = 'ai'
ALTER TABLE project
  ADD CONSTRAINT chk_ai_fields
    CHECK (
      (generation_type = 'photogrammetry' AND ai_provider IS NULL)
      OR
      (generation_type = 'ai' AND ai_provider IS NOT NULL AND ai_input_type IS NOT NULL)
    );

-- Indice per query sui task AI in corso (polling)
CREATE INDEX idx_project_ai_task ON project (ai_task_id)
  WHERE ai_task_id IS NOT NULL;

COMMENT ON COLUMN project.generation_type IS 'Tipo di generazione: photogrammetry (default) o ai';
COMMENT ON COLUMN project.ai_provider IS 'Provider AI (solo per generation_type=ai)';
COMMENT ON COLUMN project.ai_input_type IS 'Tipo input: image o text (solo per generation_type=ai)';
COMMENT ON COLUMN project.ai_prompt IS 'Prompt testuale per text-to-3D (solo per ai_input_type=text)';
COMMENT ON COLUMN project.ai_task_id IS 'ID task esterno dal provider cloud (per polling stato)';
```

### 4.3 Estensione ProjectSchema in Zod

```javascript
// Estensione di src/utils/db.js - ProjectSchema
const ProjectSchema = z.object({
  id: z.number().int().positive(),
  status: z.string(),
  files: z.array(z.string()).min(1, 'Project must have at least one file'),
  detail: z.string().nullable().optional().default('medium'),
  feature: z.string().nullable().optional().default('normal'),
  order: z.string().nullable().optional().default('unordered'),
  telegram_user: z.number().int().positive().nullable().optional(),
  process_start: z.string().nullable().optional(),
  process_end: z.string().nullable().optional(),
  model_urls: z.array(z.string()).nullable().optional(),
  model_dimensions: z.object({ /* ... invariato ... */ }).nullable().optional(),

  // Nuovi campi AI
  generation_type: z.enum(['photogrammetry', 'ai']).default('photogrammetry'),
  ai_provider: z.string().nullable().optional(),
  ai_input_type: z.enum(['image', 'text']).nullable().optional(),
  ai_prompt: z.string().nullable().optional(),
  ai_task_id: z.string().nullable().optional(),
}).passthrough();
```

### 4.4 Transizioni di Stato Estese

```
FOTOGRAMMETRIA (invariato):
  [nuovo] --> processing --> done   (con model_urls)
                         --> error

GENERAZIONE AI (cloud providers):
  [nuovo] --> processing --> generating --> polling --> converting --> done
                                                                  --> error

GENERAZIONE AI (self-hosted):
  [nuovo] --> processing --> generating --> converting --> done
                                                       --> error
```

---

## 5. Estensione Configurazione

### 5.1 Nuove Variabili d'Ambiente

Le variabili seguenti si aggiungono a quelle esistenti definite in `src/config.js:6-28`. Tutte sono opzionali: il sistema funziona anche senza nessuna di esse (rimane solo la fotogrammetria).

```env
# === Provider Cloud AI ===

# Tripo AI (https://www.tripo3d.ai)
TRIPO_API_KEY=sk-...

# Meshy (https://www.meshy.ai)
MESHY_API_KEY=...

# Hyper / Rodin (https://hyper3d.ai)
RODIN_API_KEY=...

# === Modelli Self-hosted ===

# Directory contenente i modelli scaricati (weights)
AI_MODELS_DIR=/Volumes/T7/ai-models

# Dispositivo GPU per inferenza (solo self-hosted)
# Opzioni: cpu, cuda:0, cuda:1, mps (Apple Silicon GPU)
AI_GPU_DEVICE=mps

# Timeout generazione AI in millisecondi (default: 10 minuti)
AI_GENERATION_TIMEOUT=600000

# Python virtualenv per modelli self-hosted
AI_PYTHON_VENV=/Volumes/T7/ai-venv
```

### 5.2 Estensione ConfigSchema

```javascript
// Estensione di src/config.js
const ConfigSchema = z.object({
  // ... campi esistenti invariati (src/config.js:7-27) ...

  // Provider cloud AI (opzionali)
  TRIPO_API_KEY: z.string().min(1).optional(),
  MESHY_API_KEY: z.string().min(1).optional(),
  RODIN_API_KEY: z.string().min(1).optional(),

  // Self-hosted (opzionali)
  AI_MODELS_DIR: z.string().optional(),
  AI_GPU_DEVICE: z.string().default('mps'),
  AI_GENERATION_TIMEOUT: z.coerce.number().default(600000),
  AI_PYTHON_VENV: z.string().optional(),
});
```

> Nota: su macOS con Apple Silicon, il device consigliato per i modelli self-hosted e' `mps` (Metal Performance Shaders). L'opzione `cuda` e' disponibile solo su sistemi con GPU NVIDIA.

---

## 6. AIProcessManager - Design

### 6.1 Interfaccia della Classe

La classe `AIProcessManager` rispecchia l'interfaccia di `ProcessManager` (`src/ProcessManager.js:33-376`) per mantenere coerenza architetturale:

```javascript
// src/AIProcessManager.js

class AIProcessManager {
  /**
   * @param {string|number} id     - ID progetto
   * @param {Object} project       - Dati progetto da Supabase
   * @param {Object} messageData   - Dati completi dal messaggio in coda
   */
  constructor(id, project, messageData) {
    this.id = id;
    this.project = project;
    this.provider = messageData.provider;
    this.inputType = messageData.input_type;
    this.prompt = messageData.prompt;
    this.aiOptions = messageData.ai_options || {};
    this.imgDir = path.join(config.PROJECTS_BASE_DIR, `${id}`, 'images');
    this.outDir = path.join(config.PROJECTS_BASE_DIR, `${id}`, 'model');
    this.isTelegram = !!project.telegram_user;
  }

  async process()           // Orchestratore principale
  async prepareInput()      // Scarica immagine sorgente se input_type=image
  async generateModel()     // Delega al provider AI selezionato
  async convertFormat()     // Converte output AI (GLB/PLY) -> OBJ + USDZ
  async uploadToS3()        // Riusa src/utils/s3.js -> uploadDir()
  async notifyTelegram()    // Riusa src/utils/telegram.js
  async updateStatus()      // Riusa src/utils/db.js -> updateProject()
  async cleanupAll()        // Pulizia directory locali

  static async create(id, messageData)  // Factory method
}
```

### 6.2 Flusso di Esecuzione di `process()`

```
AIProcessManager.process()
  |
  |  1. checkDiskSpace()
  |     Verifica 500MB liberi (stessa logica di ProcessManager.js:73-90)
  |
  |  2. updateStatus('processing')
  |     Imposta process_start, generation_type='ai', ai_provider
  |
  |  3. mkdir(imgDir), mkdir(outDir)
  |     Crea directory di lavoro
  |
  |  4. prepareInput()
  |     Se input_type='image': scarica l'immagine sorgente da R2 o Telegram
  |     Se input_type='text': nessun download (usa solo il prompt)
  |
  |  5. generateModel()
  |     Istanzia il provider corretto (Strategy Pattern, vedi sezione 7)
  |     Cloud: invia richiesta API -> polling -> download risultato
  |     Self-hosted: spawn processo Python -> attende output
  |     Salva il risultato in outDir (formato nativo del provider)
  |
  |  6. convertFormat()
  |     Converte l'output AI nei formati standard:
  |     GLB/PLY/STL -> OBJ + MTL (via trimesh/gltf-pipeline)
  |     OBJ -> USDZ (via xcrun usdconvert, solo macOS)
  |
  |  7. uploadToS3()
  |     Carica tutti i file da outDir su R2
  |     Path: {projectId}/model/{filename}
  |     Riusa uploadDir() da src/utils/s3.js:78-95
  |
  |  8. notifyTelegram()
  |     Se il progetto ha telegram_user, invia notifica e file
  |     Riusa sendMessage() e sendDocument() da src/utils/telegram.js
  |
  |  9. updateStatus('done', { model_urls, model_dimensions })
  |     Imposta process_end e URL dei modelli generati
  |
  | 10. cleanupAll()
  |     Rimuove imgDir e outDir
  |
  | ERRORE (in qualsiasi step):
  |     -> updateStatus('error')
  |     -> cleanupAll()
  |     -> throw error (propagato a processQueue.js -> nack -> DLQ)
```

### 6.3 Confronto con ProcessManager

| Aspetto | ProcessManager | AIProcessManager |
|---------|---------------|-----------------|
| Sorgente input | Immagini multiple (R2/Telegram) | Singola immagine o prompt testuale |
| Elaborazione | PhotoProcess binary (Swift/RealityKit) | Provider AI (cloud API o Python) |
| Timeout | 30 minuti (`PHOTOGRAMMETRY_TIMEOUT`) | 10 minuti (`AI_GENERATION_TIMEOUT`) |
| Output nativo | USDZ + OBJ | GLB/PLY/STL (varia per provider) |
| Conversione | Integrata nel binario | Step separato post-generazione |
| Riuso moduli | `s3.js`, `db.js`, `telegram.js` | `s3.js`, `db.js`, `telegram.js` (identici) |

---

## 7. Provider Strategy Pattern

### 7.1 Interfaccia Base

Ogni provider AI implementa la stessa interfaccia, consentendo al `AIProcessManager` di operare senza conoscere i dettagli implementativi:

```javascript
// src/ai/providers/BaseProvider.js

class BaseProvider {
  constructor(config) {
    this.config = config;
  }

  /**
   * Avvia la generazione del modello 3D
   * @param {Object} input
   * @param {string} input.imagePath   - Path immagine locale (se input_type=image)
   * @param {string} input.prompt      - Prompt testuale (se input_type=text)
   * @param {Object} options           - Opzioni specifiche del provider
   * @returns {Promise<{taskId: string, outputPath?: string, format: string}>}
   */
  async generate(input, options) {
    throw new Error('generate() must be implemented');
  }

  /**
   * Controlla lo stato di un task in corso (solo cloud providers)
   * @param {string} taskId
   * @returns {Promise<{status: string, progress: number}>}
   */
  async checkStatus(taskId) {
    throw new Error('checkStatus() must be implemented');
  }

  /**
   * Scarica il risultato di un task completato (solo cloud providers)
   * @param {string} taskId
   * @param {string} outputDir
   * @returns {Promise<string>} Path del file scaricato
   */
  async downloadResult(taskId, outputDir) {
    throw new Error('downloadResult() must be implemented');
  }
}
```

### 7.2 Struttura Directory dei Provider

```
src/ai/
├── providers/
│   ├── BaseProvider.js          # Classe base (interfaccia)
│   ├── TripoProvider.js         # Tripo AI (cloud)
│   ├── MeshyProvider.js         # Meshy (cloud)
│   ├── RodinProvider.js         # Hyper/Rodin (cloud)
│   ├── TripoSRProvider.js       # TripoSR (self-hosted)
│   ├── SPAR3DProvider.js        # SPAR3D (self-hosted)
│   ├── ShapEProvider.js         # Shap-E (self-hosted)
│   ├── InstantMeshProvider.js   # InstantMesh (self-hosted)
│   └── Hunyuan3DProvider.js    # Hunyuan3D (self-hosted)
├── providerFactory.js           # Factory per istanziare il provider corretto
├── formatConverter.js           # Conversione formati (GLB->OBJ, OBJ->USDZ)
└── AIProcessManager.js          # Orchestratore AI
```

### 7.3 Implementazione Cloud Provider (esempio Tripo)

```javascript
// src/ai/providers/TripoProvider.js

class TripoProvider extends BaseProvider {
  constructor(config) {
    super(config);
    this.apiKey = config.TRIPO_API_KEY;
    this.baseUrl = 'https://api.tripo3d.ai/v2/openapi';
  }

  async generate(input, options) {
    const body = input.imagePath
      ? await this._buildImageRequest(input.imagePath, options)
      : this._buildTextRequest(input.prompt, options);

    const response = await fetch(`${this.baseUrl}/task`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    return { taskId: data.data.task_id, format: 'glb' };
  }

  async checkStatus(taskId) {
    const response = await fetch(`${this.baseUrl}/task/${taskId}`, {
      headers: { 'Authorization': `Bearer ${this.apiKey}` },
    });
    const data = await response.json();
    return {
      status: data.data.status,     // 'queued' | 'running' | 'success' | 'failed'
      progress: data.data.progress,  // 0-100
    };
  }

  async downloadResult(taskId, outputDir) {
    const status = await this.checkStatus(taskId);
    const modelUrl = status.output.model;
    const outputPath = path.join(outputDir, 'model.glb');

    const response = await fetch(modelUrl);
    const buffer = await response.arrayBuffer();
    await fs.promises.writeFile(outputPath, Buffer.from(buffer));

    return outputPath;
  }
}
```

### 7.4 Implementazione Self-hosted Provider (esempio TripoSR)

```javascript
// src/ai/providers/TripoSRProvider.js

class TripoSRProvider extends BaseProvider {
  constructor(config) {
    super(config);
    this.modelsDir = config.AI_MODELS_DIR;
    this.device = config.AI_GPU_DEVICE || 'mps';
    this.venvPython = config.AI_PYTHON_VENV
      ? path.join(config.AI_PYTHON_VENV, 'bin', 'python')
      : 'python3';
  }

  async generate(input, options) {
    const outputPath = path.join(options.outputDir, 'model.obj');

    return new Promise((resolve, reject) => {
      const args = [
        '-m', 'triposr',
        '--image', input.imagePath,
        '--output', outputPath,
        '--device', this.device,
        '--model-dir', this.modelsDir,
      ];

      const child = spawn(this.venvPython, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, CUDA_VISIBLE_DEVICES: this.device },
      });

      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error('AI generation timeout'));
      }, config.AI_GENERATION_TIMEOUT);

      child.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          reject(new Error(`TripoSR exited with code ${code}`));
          return;
        }
        resolve({ outputPath, format: 'obj' });
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  // Self-hosted: non serve polling
  async checkStatus() {
    return { status: 'not_applicable', progress: 100 };
  }

  async downloadResult() {
    return null; // Il file e' gia' locale
  }
}
```

### 7.5 Provider Factory

```javascript
// src/ai/providerFactory.js

const providers = {
  // Cloud
  tripo:        () => new (require('./providers/TripoProvider'))(config),
  meshy:        () => new (require('./providers/MeshyProvider'))(config),
  rodin:        () => new (require('./providers/RodinProvider'))(config),
  // Self-hosted
  triposr:      () => new (require('./providers/TripoSRProvider'))(config),
  spar3d:       () => new (require('./providers/SPAR3DProvider'))(config),
  'shap-e':     () => new (require('./providers/ShapEProvider'))(config),
  instantmesh:  () => new (require('./providers/InstantMeshProvider'))(config),
  hunyuan3d:    () => new (require('./providers/Hunyuan3DProvider'))(config),
};

function createProvider(name) {
  const factory = providers[name];
  if (!factory) {
    throw new Error(`Unknown AI provider: ${name}`);
  }
  return factory();
}

module.exports = { createProvider };
```

### 7.6 Riepilogo Provider

| Provider | Tipo | Input supportati | Output nativo | Polling |
|----------|------|-----------------|---------------|---------|
| Tripo | Cloud | image, text | GLB | Si (HTTP) |
| Meshy | Cloud | image, text | GLB, FBX, OBJ | Si (HTTP) |
| Rodin | Cloud | image, text | GLB | Si (HTTP) |
| TripoSR | Self-hosted | image | OBJ | No (sincrono) |
| SPAR3D | Self-hosted | image | PLY, GLB | No (sincrono) |
| Shap-E | Self-hosted | text | PLY, STL | No (sincrono) |
| InstantMesh | Self-hosted | image | OBJ, GLB | No (sincrono) |
| Hunyuan3D | Self-hosted | image, text | GLB (PBR), OBJ | No (sincrono) |

---

## 8. Pipeline Conversione Formati

### 8.1 Problema

Ogni provider AI produce output in formati diversi (GLB, PLY, STL, OBJ). Il sistema esistente si aspetta file nel formato standard: `model.usdz`, `model.obj`, `model.mtl` e texture. La pipeline di conversione normalizza tutti gli output.

### 8.2 Flusso di Conversione

```
Output del provider AI
         |
         v
  +------+-------+
  | Formato       |
  | rilevato?     |
  +------+-------+
         |
    +----+----+----+----+
    |         |         |
   GLB       PLY       STL       OBJ (gia' pronto)
    |         |         |              |
    v         v         v              |
  gltf-     trimesh   trimesh          |
  pipeline   (Python)  (Python)        |
    |         |         |              |
    v         v         v              |
   OBJ  <----+----<----+              |
    +                                  |
    | (model.obj + model.mtl + texture)
    v
  xcrun usdconvert
    |
    v
  model.usdz
    |
    v
  Tutti i file in outDir pronti per upload
```

### 8.3 Strumenti di Conversione

| Conversione | Strumento | Piattaforma | Comando/Metodo |
|-------------|-----------|-------------|----------------|
| GLB -> OBJ + MTL | `gltf-pipeline` (npm) | Cross-platform | `gltf-pipeline -i model.glb -o model.obj` |
| GLB -> OBJ + MTL | `trimesh` (Python) | Cross-platform | `trimesh.load('model.glb').export('model.obj')` |
| PLY -> OBJ | `trimesh` (Python) | Cross-platform | `trimesh.load('model.ply').export('model.obj')` |
| STL -> OBJ | `trimesh` (Python) | Cross-platform | `trimesh.load('model.stl').export('model.obj')` |
| OBJ -> USDZ | `xcrun usdconvert` | macOS only | `xcrun usdconvert model.obj model.usdz` |

### 8.4 Implementazione del Convertitore

```javascript
// src/ai/formatConverter.js

const { spawn } = require('child_process');
const path = require('path');

const CONVERSION_TIMEOUT = 5 * 60 * 1000; // 5 minuti

/**
 * Converte un file 3D nel formato OBJ + genera USDZ
 * @param {string} inputPath - Path del file sorgente (GLB, PLY, STL)
 * @param {string} outputDir - Directory di output
 * @returns {Promise<{objPath: string, usdzPath: string}>}
 */
async function convertToStandard(inputPath, outputDir) {
  const ext = path.extname(inputPath).toLowerCase();
  let objPath;

  // Step 1: Conversione a OBJ (se necessario)
  if (ext === '.obj') {
    objPath = inputPath;
  } else if (ext === '.glb' || ext === '.gltf') {
    objPath = await convertWithGltfPipeline(inputPath, outputDir);
  } else {
    objPath = await convertWithTrimesh(inputPath, outputDir);
  }

  // Step 2: Generazione USDZ (macOS only)
  const usdzPath = await convertToUsdz(objPath, outputDir);

  return { objPath, usdzPath };
}

/**
 * Converte OBJ a USDZ usando xcrun usdconvert (macOS)
 */
async function convertToUsdz(objPath, outputDir) {
  const usdzPath = path.join(outputDir, 'model.usdz');

  return new Promise((resolve, reject) => {
    const child = spawn('xcrun', ['usdconvert', objPath, usdzPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('USDZ conversion timeout'));
    }, CONVERSION_TIMEOUT);

    child.on('close', (code) => {
      clearTimeout(timer);
      code === 0 ? resolve(usdzPath) : reject(new Error(`usdconvert exit code ${code}`));
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}
```

---

## 9. Routing nel processQueue.js

### 9.1 Modifiche al Consumer

Il file `src/processQueue.js` richiede modifiche minime. Il cambiamento principale riguarda la funzione `handler` (riga 40) e lo schema `QueueMessageSchema` (riga 14):

```javascript
// src/processQueue.js - Versione estesa

const ProcessManager = require('./ProcessManager');
const AIProcessManager = require('./ai/AIProcessManager');

// Schema esteso (vedi sezione 3.2)
const QueueMessageSchema = z.union([
  z.string().regex(/^\d+$/).transform(Number)
    .transform(id => ({ id, type: 'photogrammetry' })),
  AIMessageSchema,
  PhotogrammetryMessageSchema
    .transform(obj => ({ id: obj.id, type: 'photogrammetry' })),
]);

/**
 * Gestisce un singolo processo dalla coda
 * Instrada al manager corretto in base al tipo di messaggio
 * @param {Object} messageData - Dati parsati dal messaggio
 */
const handler = async (messageData) => {
  const { id, type } = messageData;

  if (type === 'ai') {
    const aiManager = await AIProcessManager.create(id, messageData);
    await aiManager.process();
  } else {
    const processManager = await ProcessManager.create(id);
    await processManager.process();
  }
};
```

### 9.2 Modifiche al Callback del Consumer

La sezione del consumer in `src/processQueue.js:104-133` cambia in modo minimale:

```javascript
// Prima (src/processQueue.js:122-125):
const id = result.data;
try {
  await handler(id);
  console.log(' [x] Done', id);

// Dopo:
const messageData = result.data;
try {
  await handler(messageData);
  console.log(' [x] Done', messageData.id);
```

### 9.3 Impatto sulle Altre Funzioni

| Funzione | File | Modifica necessaria |
|----------|------|-------------------|
| `parseQueueMessage()` | `src/processQueue.js:24-34` | Nessuna (lo schema gestisce il parsing) |
| `connectWithRetry()` | `src/processQueue.js:50-65` | Nessuna |
| `startConsumer()` | `src/processQueue.js:70-134` | Minima (vedi 9.2) |
| `shutdown()` | `src/processQueue.js:137-163` | Nessuna |
| `ProcessManager` | `src/ProcessManager.js` | Nessuna (invariato) |
| `s3.js` | `src/utils/s3.js` | Nessuna (riusato da AIProcessManager) |
| `db.js` | `src/utils/db.js` | Estensione schema Zod (vedi 4.3) |
| `telegram.js` | `src/utils/telegram.js` | Nessuna (riusato da AIProcessManager) |

---

## 10. Error Handling e Retry

### 10.1 Gestione Errori per Provider Cloud

I provider cloud API (Tripo, Meshy, Rodin) hanno pattern di errore specifici che richiedono strategie dedicate:

```
Chiamata API al provider cloud
         |
         v
  +------+-------+
  | HTTP Status?  |
  +------+-------+
         |
    +----+----+----+----+----+
    |         |         |    |
   200       429       5xx  altro
   (OK)   (rate      (server  (errore
    |     limit)    error)   client)
    |         |         |        |
    v         v         v        v
  Procedi   Backoff   Retry    Fail
            esponen.  (max 3)  immediato
            (max 60s)          -> DLQ
              |         |
              v         v
            Retry     Retry
            (max 5)   (max 3)
              |         |
              v         v
         Fail se     Fail se
         esauriti    esauriti
```

**Strategia di backoff esponenziale per rate limiting (429):**

```javascript
async function withRetry(fn, { maxRetries = 5, baseDelay = 2000 } = {}) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (error.status === 429 && attempt < maxRetries) {
        // Rispetta header Retry-After se presente
        const retryAfter = error.headers?.['retry-after'];
        const delay = retryAfter
          ? parseInt(retryAfter) * 1000
          : Math.min(baseDelay * Math.pow(2, attempt - 1), 60000);
        console.warn(`Rate limited, retry in ${delay}ms (attempt ${attempt}/${maxRetries})`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw error;
    }
  }
}
```

**Timeout per polling dei task cloud:**

| Provider | Timeout polling | Intervallo polling | Max tentativi |
|----------|----------------|-------------------|---------------|
| Tripo | 10 minuti | 5 secondi | 120 |
| Meshy | 10 minuti | 5 secondi | 120 |
| Rodin | 10 minuti | 10 secondi | 60 |

### 10.2 Gestione Errori per Provider Self-hosted

I provider self-hosted (TripoSR, SPAR3D, Shap-E, InstantMesh) hanno pattern di errore legati all'esecuzione di processi Python:

| Errore | Causa | Gestione |
|--------|-------|----------|
| Exit code != 0 | Errore generico Python | Log stderr, fail, DLQ |
| SIGTERM (timeout) | Generazione troppo lunga | Kill processo, fail |
| `CUDA out of memory` | GPU memoria insufficiente | Log, fail, possibile retry con quality ridotta |
| `ModuleNotFoundError` | Dipendenza Python mancante | Fail immediato, log esplicito |
| `FileNotFoundError` | Modello/weights non trovati | Fail immediato, log path |
| `ENOMEM` | Memoria sistema insufficiente | Fail, segnalazione critica |

**Rilevamento errori GPU (stderr parsing):**

```javascript
child.stderr.on('data', (data) => {
  const text = data.toString();
  if (text.includes('CUDA out of memory') || text.includes('MPS backend out of memory')) {
    gpuOOM = true;
  }
  console.error(`[ai:${provider}:err] ${text.trim()}`);
});
```

### 10.3 Flusso Stati Uniforme

Indipendentemente dal tipo di errore, il flusso di stati rimane coerente con il sistema esistente (`src/ProcessManager.js:297-362`):

```
Qualsiasi errore nella pipeline AI:
    -> updateStatus('error') con process_end      (come ProcessManager.js:354)
    -> cleanupAll() rimuove file locali            (come ProcessManager.js:359)
    -> throw error                                 (propagato al consumer)
    -> channel.nack(msg, false, false)             (come processQueue.js:131)
    -> Messaggio inviato alla Dead Letter Queue    (come processQueue.js:91)
```

### 10.4 Tabella Riepilogativa Timeout

| Operazione | Timeout | Definito in |
|------------|---------|-------------|
| Fotogrammetria (PhotoProcess) | 30 min | `src/ProcessManager.js:31` |
| Generazione AI (cloud) | 10 min | `AI_GENERATION_TIMEOUT` env var |
| Generazione AI (self-hosted) | 10 min | `AI_GENERATION_TIMEOUT` env var |
| Conversione formato | 5 min | `src/ai/formatConverter.js` |
| Connessione AMQP | ~5 min | `src/processQueue.js:50-65` (10 retry) |
| Graceful shutdown | 10 sec | `src/processQueue.js:143-146` |

---

## 11. Riferimenti

### Documenti nella Serie `docs/ai-generation/`

| Documento | Contenuto |
|-----------|-----------|
| `01-*.md` - `08-*.md` | Documenti precedenti della serie (analisi provider, confronti, requisiti) |
| **`09-architecture.md`** | **Questo documento** - Architettura di integrazione |
| `10-hunyuan3d.md` | Hunyuan3D - modello open source con PBR nativo (Tencent) |
| `11-comfyui-pipeline.md` | ComfyUI come orchestratore pipeline alternativo |

### File Sorgente Principali (Riferimenti)

| File | Righe rilevanti | Descrizione |
|------|----------------|-------------|
| `src/processQueue.js` | `:14-17` | Schema messaggi coda (da estendere) |
| `src/processQueue.js` | `:40-43` | Handler function (da estendere con routing) |
| `src/processQueue.js` | `:104-133` | Consumer callback (modifica minimale) |
| `src/ProcessManager.js` | `:33-46` | Constructor (pattern da replicare in AIProcessManager) |
| `src/ProcessManager.js` | `:297-363` | Metodo process() (pattern da replicare) |
| `src/ProcessManager.js` | `:370-373` | Factory method create() (pattern da replicare) |
| `src/config.js` | `:6-28` | ConfigSchema (da estendere con chiavi AI) |
| `src/utils/db.js` | `:4-27` | ProjectSchema con `.passthrough()` (da estendere) |
| `src/utils/s3.js` | `:78-95` | `uploadDir()` (riusato invariato) |
| `src/utils/telegram.js` | `:1-11` | `sendMessage()`, `sendDocument()` (riusati invariati) |

### Documentazione Esterna

- [Tripo AI API](https://www.tripo3d.ai/docs/api) - Documentazione API Tripo
- [Meshy API](https://docs.meshy.ai) - Documentazione API Meshy
- [Hyper3D / Rodin](https://hyper3d.ai/docs) - Documentazione API Rodin
- [TripoSR (GitHub)](https://github.com/VAST-AI-Research/TripoSR) - Modello open-source image-to-3D
- [SPAR3D (GitHub)](https://github.com/Stability-AI/stable-point-aware-3d) - Stable Point-Aware 3D
- [Shap-E (GitHub)](https://github.com/openai/shap-e) - Modello text/image-to-3D di OpenAI
- [InstantMesh (GitHub)](https://github.com/TencentARC/InstantMesh) - Ricostruzione mesh efficiente
- [Hunyuan3D (GitHub)](https://github.com/Tencent-Hunyuan/Hunyuan3D-2) - Generazione 3D con PBR nativo
- [ComfyUI (GitHub)](https://github.com/comfyanonymous/ComfyUI) - Orchestratore pipeline AI visuale
- [trimesh (Python)](https://trimesh.org/) - Libreria Python per operazioni su mesh 3D
- [gltf-pipeline (npm)](https://www.npmjs.com/package/gltf-pipeline) - Strumenti di conversione glTF
- [xcrun usdconvert](https://developer.apple.com/documentation/realitykit/usdconvert) - Conversione USDZ su macOS
- [docs/TECHNICAL.md](../TECHNICAL.md) - Documentazione tecnica del sistema esistente
