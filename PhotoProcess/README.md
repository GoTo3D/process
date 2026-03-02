# PhotoProcess

CLI macOS per fotogrammetria basato su Apple Object Capture API (RealityKit). Converte set di immagini in modelli 3D nei formati USDZ e OBJ.

## Requisiti

- **macOS 14+** (Sonoma o successivo)
- **Swift 6.0+**
- **Xcode** con RealityKit e ModelIO frameworks

## Build

```bash
bash build.sh
```

Lo script compila in modalità release (`swift build -c release`) e copia il binario in `../src/lib/PhotoProcess`, creando un backup del binario precedente come `.bak`.

## Utilizzo

```
PhotoProcess <inputDirectory> <outputDirectory> [opzioni]
```

### Argomenti obbligatori

| Argomento | Descrizione |
|---|---|
| `inputDirectory` | Percorso alla directory contenente le immagini sorgente |
| `outputDirectory` | Percorso alla directory di output per i modelli generati |

### Opzioni

| Opzione | Tipo | Default | Descrizione |
|---|---|---|---|
| `--detail` | String | `medium` | Livello di dettaglio: `preview`, `reduced`, `medium`, `full`, `raw`, `custom` |
| `--ordering` | String | `unordered` | Ordinamento immagini: `unordered`, `sequential` |
| `--feature-sensitivity` | String | `normal` | Sensibilità feature: `normal`, `high` |
| `--no-object-masking` | Flag | `false` | Disabilita il masking automatico degli oggetti |
| `--skip-usdz` | Flag | `false` | Genera solo OBJ (salta USDZ) |
| `--skip-obj` | Flag | `false` | Genera solo USDZ (salta OBJ) |
| `--bounds` | String | - | Bounding box: `minX,minY,minZ,maxX,maxY,maxZ` |
| `--checkpoint-directory` | String | - | Percorso per checkpoint di processing ripristinabile |

### Opzioni custom detail

Disponibili solo con `--detail custom`. Almeno una tra `--max-polygons`, `--texture-dimension` o `--texture-format` è richiesta.

| Opzione | Tipo | Descrizione |
|---|---|---|
| `--max-polygons` | Int | Numero massimo di poligoni |
| `--texture-dimension` | String | Dimensione texture: `1k`, `2k`, `4k`, `8k`, `16k` (16k richiede macOS 15+) |
| `--texture-format` | String | Formato texture: `png`, `jpeg` |
| `--texture-quality` | Float | Qualità JPEG: `0.0` - `1.0` (default: `0.8`) |
| `--texture-maps` | String | Mappe texture (comma-separated): `diffuse`, `normal`, `roughness`, `displacement`, `ao`, `all` |

### Esempio

```bash
PhotoProcess ./images ./output --detail full --ordering sequential --feature-sensitivity high
PhotoProcess ./images ./output --detail custom --max-polygons 50000 --texture-dimension 4k --texture-format jpeg --texture-quality 0.9
```

## Architettura

Il package è composto da 7 file sorgente in `Sources/PhotoProcess/`:

### `PhotoProcess.swift` — Entry point CLI

Struct `@main` che implementa `AsyncParsableCommand` (swift-argument-parser). Definisce tutti gli argomenti e le opzioni CLI, esegue la validazione dei parametri nel metodo `validate()`, e nel metodo `run()` costruisce le configurazioni e avvia il `SessionRunner`.

### `SessionRunner.swift` — Orchestratore processing

Gestisce il ciclo di vita completo della `PhotogrammetrySession` di RealityKit:
- Prepara le directory di output
- Configura la sessione (ordering, feature sensitivity, object masking, checkpoint)
- Installa handler per SIGTERM/SIGINT per cancellazione graceful della sessione
- Invia le richieste USDZ e OBJ in un'unica sessione tramite `session.process(requests:)`
- Itera gli output asincroni della sessione (progress, complete, error, ecc.)
- Al completamento: flatten dell'output OBJ, verifica dei file, estrazione dimensioni modello

### `ProgressReporter.swift` — Emissione eventi JSON

Emette eventi JSON su **stdout** (una riga per evento, chiavi ordinate) e messaggi di debug su **stderr** con prefisso `[PhotoProcess]`. Il consumer Node.js legge stdout linea per linea per tracciare il progresso.

### `OutputManager.swift` — Gestione directory e file output

Gestisce la creazione delle directory di output, la verifica dei file generati (esistenza e dimensione > 0 byte), e il flatten dell'output OBJ. RealityKit produce i file OBJ in una sottodirectory `obj/`; il metodo `flattenObjOutput()` li sposta nella directory base per semplificare l'upload.

### `DetailConfiguration.swift` — Configurazione livelli di dettaglio

Mappa le stringhe CLI ai valori enum di RealityKit (`PhotogrammetrySession.Request.Detail`). Per il livello `custom`, costruisce una `CustomDetailSpecification` con polygon count, dimensione texture, formato e mappe configurabili. La texture 16K è disponibile solo su macOS 15+ con fallback automatico a 8K.

### `BoundsParser.swift` — Parsing bounding box

Enum namespace che effettua il parsing di una stringa di 6 float separati da virgola (`minX,minY,minZ,maxX,maxY,maxZ`) in una struttura `ParsedBounds` con valori `SIMD3<Float>`. Valida il conteggio dei valori e che max > min su ogni asse.

### `ModelInfoExtractor.swift` — Estrazione dimensioni modello 3D

Enum namespace che usa ModelIO (`MDLAsset`) per leggere il bounding box di un file USDZ o OBJ e calcolare le dimensioni (width, height, depth) del modello generato.

## Formato output JSON

Il progresso e gli eventi vengono emessi su **stdout** come righe JSON. Ogni evento ha un campo `type`:

| `type` | Campi aggiuntivi | Descrizione |
|---|---|---|
| `progress` | `request`, `fraction`, `stage`?, `eta_seconds`? | Progresso di una richiesta (0.0 - 1.0). `stage` e `eta_seconds` presenti quando disponibili |
| `complete` | `request`, `output_path` | Richiesta completata con successo |
| `error` | `request`, `message` | Errore durante l'elaborazione di una richiesta |
| `input_complete` | - | Tutte le immagini di input sono state caricate |
| `invalid_sample` | `sample_id`, `reason` | Immagine di input non valida |
| `skipped_sample` | `sample_id` | Immagine di input saltata |
| `downsampling` | `message` | Downsampling automatico applicato |
| `stitching_incomplete` | `message` | Non tutte le immagini sono state unite |
| `cancelled` | - | Processing cancellato (via SIGTERM/SIGINT) |
| `processing_complete` | - | Elaborazione completata con successo |
| `model_info` | `dimensions`, `bounding_box`, `unit` | Dimensioni del modello generato |

### Esempio evento `progress`

```json
{"fraction":0.45,"request":"usdz","stage":"meshGeneration","type":"progress"}
```

### Esempio evento `model_info`

```json
{"bounding_box":{"max":{"x":1.5,"y":2.0,"z":1.0},"min":{"x":-1.5,"y":0.0,"z":-1.0}},"dimensions":{"depth":2.0,"height":2.0,"width":3.0},"type":"model_info","unit":"meters"}
```

### Valori di `stage`

`preProcessing`, `imageAlignment`, `pointCloudGeneration`, `meshGeneration`, `textureMapping`, `optimization`

### Valori di `request`

`usdz`, `obj`

## Dipendenze

| Dipendenza | Tipo | Utilizzo |
|---|---|---|
| [swift-argument-parser](https://github.com/apple/swift-argument-parser) >= 1.5.0 | Package SPM | Parsing argomenti CLI |
| RealityKit | Framework Apple | Object Capture API (`PhotogrammetrySession`) |
| ModelIO | Framework Apple | Estrazione dimensioni modello (`MDLAsset`) |

## Test

```bash
cd PhotoProcess
swift test
```

I test coprono le componenti di logica pura:

- **BoundsParserTests** — Parsing valido (con e senza spazi, valori negativi), errori per conteggio errato, valori non numerici, max < min
- **DetailConfigurationTests** — Mapping dei livelli di dettaglio, configurazione custom con polygons/texture maps/JPEG quality
- **OutputManagerTests** — URL di output, verifica file (esistenza, zero-byte), flatten OBJ con gestione conflitti
