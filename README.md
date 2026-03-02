# 3D Model Processing Service

Servizio Node.js + Swift per la generazione di modelli 3D tramite fotogrammetria. Consuma job da una coda RabbitMQ, elabora immagini in modelli 3D (USDZ, OBJ, MTL) usando l'API [Object Capture](https://developer.apple.com/documentation/realitykit/realitykit-object-capture/) di Apple RealityKit, e carica i risultati su Cloudflare R2.

**Piattaforma:** macOS (Apple Silicon) - richiede macOS 14+ e Xcode 16+.

## Architettura

```
RabbitMQ -> processQueue.js -> ProcessManager -> PhotoProcess (Swift CLI) -> R2 Upload
```

1. Il consumer AMQP riceve project ID dalla coda
2. `ProcessManager` scarica le immagini da Supabase Storage o Telegram
3. `PhotoProcess` (binario Swift) genera USDZ + OBJ in un singolo step
4. I risultati vengono caricati su Cloudflare R2
5. Lo stato del progetto viene aggiornato in Supabase

## Setup

```bash
# Installa dipendenze Node.js
npm install

# Copia e configura le variabili d'ambiente
cp .env.example .env

# Compila il binario Swift PhotoProcess
bash PhotoProcess/build.sh

# Avvia il consumer
npm run dev
```

## Comandi

```bash
npm run dev              # Avvia il consumer (sviluppo)
npm start                # Avvia il consumer (produzione)
npm test                 # Esegui unit test
npm run test:local       # Test locale senza servizi esterni
npm run test:integration # Test con servizi reali
npm run test:e2e         # Test end-to-end completo
```

## PhotoProcess CLI

Il cuore dell'elaborazione e' il binario Swift `PhotoProcess`, che sostituisce i precedenti `HelloPhotogrammetry` e `usdconv` con un singolo strumento.

```bash
PhotoProcess <input-dir> <output-dir> [opzioni]

# Opzioni principali
--detail          preview|reduced|medium|full|raw|custom  (default: medium)
--ordering        unordered|sequential                    (default: unordered)
--feature-sensitivity  normal|high                        (default: normal)
--skip-usdz       Genera solo OBJ
--skip-obj         Genera solo USDZ

# Opzioni custom detail (quando --detail custom)
--max-polygons         Numero massimo di poligoni
--texture-dimension    1k|2k|4k|8k|16k
--texture-format       png|jpeg
--texture-quality      0.0-1.0 (solo per jpeg)
--texture-maps         diffuse,normal,roughness,displacement,ao,all

# Altre opzioni
--bounds               minX,minY,minZ,maxX,maxY,maxZ (bounding box)
--checkpoint-directory  Directory per checkpoint/resume
--no-object-masking     Disabilita mascheramento automatico
```

**Esempi:**

```bash
# Anteprima veloce
PhotoProcess /images /output --detail preview --skip-obj

# Qualita' massima con texture personalizzate
PhotoProcess /images /output --detail custom \
  --max-polygons 500000 --texture-dimension 8k \
  --texture-format png --texture-maps diffuse,normal,roughness
```

Il progresso viene riportato come righe JSON su stdout, parsate in tempo reale da ProcessManager.

## Struttura del Progetto

```
src/
  processQueue.js       # Consumer AMQP
  ProcessManager.js     # Orchestratore principale
  config.js             # Configurazione centralizzata (Zod)
  lib/
    PhotoProcess        # Binario Swift compilato
    supabaseClient.js   # Client Supabase
    s3Client.js         # Client Cloudflare R2
    s3Api.js            # Operazioni S3
    telegramClient.js   # Client Telegram
  utils/
    s3.js               # Upload/download con concorrenza
    db.js               # Operazioni database
    telegram.js         # Notifiche Telegram

PhotoProcess/           # Sorgente Swift della CLI
  Package.swift
  build.sh              # Build + deploy
  Sources/PhotoProcess/

test/
  unit/                 # Unit test (~195 casi)
  integration/          # Test di integrazione
  e2e/                  # Test end-to-end

docs/
  TECHNICAL.md          # Documentazione tecnica completa
  CODE_REVIEW.md        # Analisi qualita' codice e miglioramenti
```

## Servizi Esterni

| Servizio | Uso |
|----------|-----|
| **Supabase** | Database (progetti) + Storage (immagini sorgente) |
| **Cloudflare R2** | Storage modelli 3D generati |
| **RabbitMQ** | Coda job per elaborazione asincrona |
| **Telegram** | Notifiche utente e sorgente file opzionale |

## Database Schema (Supabase)

**Tabella `project`:**

| Campo | Tipo | Descrizione |
|-------|------|-------------|
| id | integer | Primary key |
| status | string | processing / done / error |
| files | string[] | Nomi file immagini sorgente |
| detail | string | Livello dettaglio |
| feature | string | Feature sensitivity |
| order | string | Ordinamento campioni |
| process_start | timestamp | Inizio elaborazione |
| process_end | timestamp | Fine elaborazione |
| model_urls | string[] | URL modelli su R2 |
| telegram_user | integer | Utente Telegram (opzionale) |

## Variabili d'Ambiente

Vedi `.env.example` per la configurazione completa:

- `SUPABASE_URL`, `SUPABASE_KEY` - Connessione Supabase
- `BOT_TOKEN` - Token bot Telegram
- `CLOUDFLARE_R2_ACCOUNT_ID`, `CLOUDFLARE_R2_ACCESS_KEY_ID`, `CLOUDFLARE_R2_SECRET_ACCESS_KEY` - Credenziali R2
- `QUEUE_CONNECTION_STRING` - URL AMQP
- `QUEUE` - Nome coda (default: `processing-dev`)
- `BUCKET` - Nome bucket R2
- `PROJECTS_BASE_DIR` - Directory lavoro locale (default: `/Volumes/T7/projects`)

## Produzione (PM2)

```bash
pm2 start ecosystem.config.js --env production
```

## Documentazione

- [`docs/TECHNICAL.md`](docs/TECHNICAL.md) - Documentazione tecnica e infrastrutturale completa
- [`docs/CODE_REVIEW.md`](docs/CODE_REVIEW.md) - Code review con criticita' e miglioramenti
- [`CLAUDE.md`](CLAUDE.md) - Istruzioni per Claude Code

## Risorse

- [Apple Object Capture](https://developer.apple.com/documentation/realitykit/realitykit-object-capture/)
- [PhotogrammetrySession API](https://developer.apple.com/documentation/realitykit/photogrammetrysession)
- [WWDC21: Create 3D models with Object Capture](https://developer.apple.com/videos/play/wwdc2021/10076/)
- [swift-argument-parser](https://github.com/apple/swift-argument-parser)
