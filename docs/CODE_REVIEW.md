# Code Review - PhotoProcess CLI e Integrazione Node.js

Data: 2 Marzo 2026
Scope: Componente Swift `PhotoProcess/` e integrazione in `src/ProcessManager.js`

---

## Riepilogo Criticita'

| Severita' | Conteggio | Descrizione |
|-----------|-----------|-------------|
| CRITICA | 3 | Sessione inutilizzata, bounds non applicati, signal handler scope |
| ALTA | 3 | Verifica output insufficiente, doppia sessione inefficiente, fraction persa |
| MEDIA | 5 | Dead code, fallback silenzioso, build script fragile, 16K silenzioso, overwrite |
| BASSA | 4 | Magic number, test mancanti, helper non usato, compactMapValues inutile |

---

## Criticita' CRITICHE

### CR-01: Sessione PhotogrammetrySession inutilizzata (resource leak)

**File:** `SessionRunner.swift:55-58`
**Problema:** Viene creata una `PhotogrammetrySession` iniziale che non viene mai usata ne' chiusa. Le sessioni USDZ e OBJ creano ciascuna la propria sessione (righe 92 e 120).

```swift
// Riga 55-58: questa sessione non viene mai usata
let session = try PhotogrammetrySession(
    input: inputURL,
    configuration: config
)
```

La `PhotogrammetrySession` alloca risorse significative (thread pool, cache immagini). Questa istanza viene allocata e poi abbandonata, lasciando il cleanup al garbage collector di Swift.

**Impatto:** Spreco di risorse, potenziale memory pressure durante l'elaborazione.

**Soluzione:** Rimuovere le righe 54-58. I signal handler devono riferirsi alla sessione attiva corrente, non a una sessione fissa.

```swift
// Soluzione: usare una variabile opzionale per la sessione attiva
var activeSession: PhotogrammetrySession?

// Nel signal handler:
signalSource.setEventHandler { [weak activeSession] in
    activeSession?.cancel()
}
```

---

### CR-02: Bounding box validato ma mai applicato (feature non funzionante)

**File:** `PhotoProcess.swift:102-104`, `SessionRunner.swift:81-83`

**Problema:** Il parametro `--bounds` viene parsato e validato in `PhotoProcess.swift` e passato a `SessionRunner`, ma non viene mai utilizzato nella creazione delle request.

```swift
// PhotoProcess.swift:128-132 - bounds viene parsato
let geometry: BoundsParser.ParsedBounds? = if let bounds {
    try BoundsParser.parse(bounds)
} else { nil }

// SessionRunner.swift:81-83 - commento indica che non e' usato
// Build geometry from bounds if provided
// Note: geometry parameter is optional and may not be available on all macOS versions
// We pass nil if no bounds are provided
```

Le request a riga 98 e 126 non passano alcun parametro `geometry:`:
```swift
.modelFile(url: usdzURL, detail: requestDetail) // manca geometry:
```

**Impatto:** L'utente puo' specificare `--bounds` senza errori ma il parametro viene completamente ignorato. Feature dichiarata ma non implementata.

**Soluzione:** Implementare il passaggio del geometry alla request, o rimuovere il parametro `--bounds` fino a quando non sara' implementato.

```swift
// Conversione ParsedBounds -> BoundingBox -> Geometry
if let bounds = self.bounds {
    let box = BoundingBox(
        min: bounds.min,
        max: bounds.max
    )
    // Usare la geometry nella request
    .modelFile(url: usdzURL, detail: requestDetail, geometry: .init(bounds: box))
}
```

> **Nota:** l'API `modelFile(url:detail:geometry:)` richiede macOS 14+ ed e' documentata in [PhotogrammetrySession.Request](https://developer.apple.com/documentation/realitykit/photogrammetrysession/request/modelfile(url:detail:geometry:)).

---

### CR-03: Signal handler potenzialmente invalidati (scope delle variabili)

**File:** `SessionRunner.swift:60-76`

**Problema:** I `DispatchSource` per SIGTERM e SIGINT sono assegnati a variabili locali (`signalSource`, `intSource`). I loro event handler catturano `session` (la sessione inutilizzata di CR-01) in una closure. In Swift, le variabili locali possono essere deallocate dal compiler se lo scope lo permette, potenzialmente invalidando i signal handler prima che servano.

```swift
let signalSource = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .global())
signalSource.setEventHandler {
    session.cancel() // session e' la sessione inutilizzata (CR-01)
}
signalSource.resume()
```

**Impatto:** Se il timeout di 30 minuti di ProcessManager.js invia SIGTERM, il handler potrebbe non essere attivo. La CLI non si fermerebbe gracefully e verrebbe uccisa con SIGKILL.

**Soluzione:** Combinare con la fix di CR-01. Usare variabili di istanza o `withExtendedLifetime`:

```swift
// Opzione 1: withExtendedLifetime
try await withExtendedLifetime((signalSource, intSource)) {
    // ... tutto il codice di elaborazione qui
}

// Opzione 2: proprietà della struct (preferita)
// Spostare signal handling in un Actor dedicato
```

---

## Criticita' ALTE

### CR-04: Doppia sessione PhotogrammetrySession (inefficienza)

**File:** `SessionRunner.swift:92-95, 120-123`

**Problema:** Per generare USDZ e OBJ vengono create due sessioni separate. Ogni sessione ri-processa completamente le immagini di input (alignment, point cloud, mesh). Questo raddoppia il tempo di elaborazione.

```swift
// Sessione 1 per USDZ
let usdzSession = try PhotogrammetrySession(input: inputURL, configuration: config)
try usdzSession.process(requests: [.modelFile(url: usdzURL, detail: requestDetail)])

// Sessione 2 per OBJ - ri-elabora tutto da zero
let objSession = try PhotogrammetrySession(input: inputURL, configuration: config)
try objSession.process(requests: [.modelFile(url: objDir, detail: requestDetail)])
```

**Impatto:** Un job che richiede 10 minuti con una singola sessione ne richiederebbe ~20 con due. Raddoppio del tempo di elaborazione e dell'uso CPU/GPU.

**Soluzione:** L'API [`process(requests:)`](https://developer.apple.com/documentation/realitykit/photogrammetrysession/process(requests:)) accetta un array di request. Usare una singola sessione con due request:

```swift
let session = try PhotogrammetrySession(input: inputURL, configuration: config)

var requests: [PhotogrammetrySession.Request] = []
if !skipUsdz {
    requests.append(.modelFile(url: usdzURL, detail: requestDetail))
}
if !skipObj {
    requests.append(.modelFile(url: objDir, detail: requestDetail))
}

try session.process(requests: requests)

// Tracciare quale request e' USDZ e quale OBJ usando l'indice
for try await output in session.outputs {
    // Usare il Request nel case pattern per identificare la request
}
```

> **Nota:** Questo richiede una logica piu' complessa nel tracking dei request nei progress events, ma dimezza il tempo di elaborazione.

---

### CR-05: Verifica output insufficiente (file corrotti non rilevati)

**File:** `OutputManager.swift:21-31`

**Problema:** `verifyOutputs()` controlla solo l'esistenza dei file, non la loro dimensione o validita'.

```swift
func verifyOutputs(skipUsdz: Bool, skipObj: Bool) -> Bool {
    if !skipUsdz {
        valid = valid && FileManager.default.fileExists(atPath: usdzOutputURL.path)
        // Un file da 0 bytes passa la verifica
    }
}
```

**Impatto:** Un file USDZ corrotto o vuoto (0 bytes) verrebbe caricato su R2 e segnalato come successo.

**Soluzione:** Verificare anche la dimensione minima:

```swift
func verifyOutputs(skipUsdz: Bool, skipObj: Bool) -> Bool {
    if !skipUsdz {
        let attrs = try? FileManager.default.attributesOfItem(atPath: usdzOutputURL.path)
        let size = attrs?[.size] as? UInt64 ?? 0
        valid = valid && size > 0
    }
    // ...
}
```

---

### CR-06: Fraction persa nei progressInfo events

**File:** `SessionRunner.swift:175-180`, `ProgressReporter.swift:47-55`

**Problema:** Quando viene emesso un evento `requestProgressInfo`, la fraction viene forzata a 0:

```swift
case .requestProgressInfo(_, let info):
    reporter.reportProgressInfo(
        label: label,
        fraction: 0, // progressInfo doesn't always include fraction
        stage: stage,
        etaSeconds: info.estimatedRemainingTime
    )
```

**Impatto:** Il ProcessManager Node.js logga `0.0%` ogni volta che riceve un progressInfo, sovrascrivendo il progresso reale precedente. L'utente vede il progresso tornare a 0%.

**Soluzione:** Tenere traccia dell'ultima fraction ricevuta e riusarla:

```swift
var lastFraction: Double = 0

case .requestProgress(_, fractionComplete: let fraction):
    lastFraction = fraction
    reporter.reportProgress(label: label, fraction: fraction)

case .requestProgressInfo(_, let info):
    reporter.reportProgressInfo(
        label: label,
        fraction: lastFraction,
        stage: stageString(info.processingStage),
        etaSeconds: info.estimatedRemainingTime
    )
```

---

## Criticita' MEDIE

### CR-07: Dead code - `labelForRequest()` mai chiamata

**File:** `ProgressReporter.swift:25-32`

**Problema:** La funzione `labelForRequest(index:)` e' definita ma mai usata. In `SessionRunner`, il label viene passato direttamente a ogni chiamata di reporting.

**Soluzione:** Rimuovere la funzione e i campi `usdzActive`/`objActive` dal `ProgressReporter`, dato che il label viene sempre fornito esternamente.

---

### CR-08: Fallback silenzioso a "medium" per detail invalido

**File:** `DetailConfiguration.swift:19`

**Problema:** Se il detail non matcha nessun case, fallback silenzioso a `.medium`:

```swift
default: return .medium // nessun avviso
```

Questo e' ridondante con la validazione in `PhotoProcess.swift:72-74` che gia' rifiuta valori invalidi. Ma se `DetailConfiguration` fosse usata indipendentemente, il fallback silenzioso potrebbe nascondere bug.

**Soluzione:** Usare `fatalError("Invalid detail: \(detail)")` nel default case, dato che la validazione avviene prima.

---

### CR-09: Build script non verifica il risultato

**File:** `PhotoProcess/build.sh:4-6`

**Problema:** Lo script usa `set -euo pipefail` (buono) ma non verifica che il binario esista e funzioni dopo la copia:

```bash
swift build -c release
cp .build/release/PhotoProcess "$DEST"
chmod +x "$DEST"
```

**Soluzione:** Aggiungere verifica:

```bash
swift build -c release
test -f .build/release/PhotoProcess || { echo "Build failed: binary not found"; exit 1; }
cp .build/release/PhotoProcess "$DEST"
chmod +x "$DEST"
"$DEST" --version || { echo "Binary verification failed"; exit 1; }
```

---

### CR-10: 16K texture dimension ignorata silenziosamente su macOS < 15

**File:** `DetailConfiguration.swift:38-41`

**Problema:** Se l'utente richiede `--texture-dimension 16k` su macOS 14, il parametro viene silenziosamente ignorato:

```swift
case "16k":
    if #available(macOS 15.0, *) {
        spec.maximumTextureDimension = .sixteenK
    }
    // Se macOS < 15: nessun avviso, usa il default
```

**Soluzione:** Loggare un warning su stderr:

```swift
case "16k":
    if #available(macOS 15.0, *) {
        spec.maximumTextureDimension = .sixteenK
    } else {
        FileHandle.standardError.write(
            Data("[WARNING] 16K texture requires macOS 15+, falling back to 8K\n".utf8)
        )
        spec.maximumTextureDimension = .eightK
    }
```

---

### CR-11: Overwrite silenzioso durante flatten

**File:** `OutputManager.swift:43-45`

**Problema:** Se un file con lo stesso nome esiste gia' nella directory base (es. dalla sessione USDZ), viene silenziosamente preservato il file esistente:

```swift
if !FileManager.default.fileExists(atPath: destination.path) {
    try FileManager.default.moveItem(at: fileURL, to: destination)
}
// Se esiste gia': file OBJ ignorato senza avviso
```

**Soluzione:** Loggare un avviso quando un file viene saltato.

---

## Criticita' BASSE

### CR-12: Magic number per compressione JPEG

**File:** `DetailConfiguration.swift:51`

Il valore `0.8` per la qualita' JPEG e' hardcoded:

```swift
let quality = textureQuality ?? 0.8
```

Suggerimento: documentare il default nel testo di help del parametro CLI.

---

### CR-13: Test Swift mancanti

**File:** `PhotoProcess/Tests/PhotoProcessTests/` (directory vuota)

Il `Package.swift` dichiara un target test che non contiene file. Aree da testare:

- `BoundsParser.parse()` con edge cases (NaN, Infinity, valori negativi)
- `DetailConfiguration.buildCustomSpecification()` con combinazioni di parametri
- `OutputManager.verifyOutputs()` con file di varie dimensioni
- JSON output di `ProgressReporter` (formato corretto, sortedKeys)

---

### CR-14: `compactMapValues` inutile

**File:** `ProgressReporter.swift:42-43`

```swift
var dict: [String: Any] = [ "type": "progress", "request": label.rawValue, "fraction": fraction ]
dict = dict.compactMapValues { $0 }  // inutile: nessun valore e' nil
```

I valori nel dizionario non sono mai `nil` (sono tutti non-opzionali). La `compactMapValues` e' un no-op.

---

### CR-15: Nessun backup del binario precedente

**File:** `PhotoProcess/build.sh`

Il build script sovrascrive il binario precedente senza backup. Se la nuova build ha un bug, non c'e' modo di fare rollback immediato.

Suggerimento: `cp "$DEST" "$DEST.bak" 2>/dev/null || true` prima del deploy.

---

## Criticita' Node.js (ProcessManager.js)

### CR-16: Nessuna validazione dei parametri custom detail nel ProcessManager

**File:** `src/ProcessManager.js:141`

Il ProcessManager accetta `custom` come detail level ma non passa i parametri aggiuntivi (max-polygons, texture-dimension, etc.) al binario PhotoProcess:

```javascript
const args = [
    this.imgDir, this.outDir,
    '--detail', detail,
    '--ordering', ordering,
    '--feature-sensitivity', feature
    // Mancano: --max-polygons, --texture-dimension, --texture-format, etc.
];
```

**Impatto:** Il detail `custom` viene passato a PhotoProcess ma senza i parametri obbligatori. PhotoProcess fallira' con errore di validazione.

**Soluzione:** Aggiungere campi nel database schema per i parametri custom e passarli al binario, oppure rimuovere `custom` dalla whitelist fino all'implementazione completa.

---

### CR-17: `libDir` path potenzialmente errato

**File:** `src/ProcessManager.js:28`

```javascript
const libDir = path.join(__dirname, '..', 'src', 'lib');
```

Questo assume che `__dirname` sia `src/`. Il path risultante e': `<progetto>/src/../src/lib` = `<progetto>/src/lib`. Funziona, ma e' ridondante. Il path piu' diretto sarebbe:

```javascript
const libDir = path.join(__dirname, 'lib');
```

---

## Miglioramenti Suggeriti (Prioritizzati)

### Priorita' 1 - Correzioni Immediate

1. **Rimuovere la sessione inutilizzata** (CR-01) - fix di 3 righe
2. **Implementare o rimuovere bounds** (CR-02) - scelta architetturale
3. **Fix signal handler scope** (CR-03) - necessario per graceful shutdown
4. **Fix fraction nei progressInfo** (CR-06) - fix di 5 righe

### Priorita' 2 - Ottimizzazione

5. **Sessione singola per USDZ+OBJ** (CR-04) - dimezza il tempo di elaborazione
6. **Verifica dimensione output** (CR-05) - previene upload di file vuoti
7. **Passare parametri custom detail** (CR-16) - completa la feature

### Priorita' 3 - Qualita'

8. **Rimuovere dead code** (CR-07, CR-14) - pulizia
9. **Migliorare build script** (CR-09, CR-15) - robustezza
10. **Aggiungere test Swift** (CR-13) - copertura
11. **Gestire 16K fallback** (CR-10) - UX

---

## Metriche Qualita' del Codice

| Metrica | Swift (PhotoProcess) | Node.js (ProcessManager) |
|---------|---------------------|--------------------------|
| Linee di codice | ~620 | ~355 |
| Copertura test | 0% | ~70% (unit) |
| Complessita' ciclomatica | Bassa-Media | Bassa |
| Documentazione inline | Minima | Buona |
| Sicurezza parametri | Validazione ArgumentParser | Whitelist + spawn |
| Gestione errori | Exit code + JSON | Promise + nack/DLQ |
| Concurrency safety | `Sendable` (parziale) | Single-threaded (Node.js) |

---

## Riferimenti

- [PhotogrammetrySession API](https://developer.apple.com/documentation/realitykit/photogrammetrysession)
- [PhotogrammetrySession.Request.modelFile](https://developer.apple.com/documentation/realitykit/photogrammetrysession/request/modelfile(url:detail:geometry:))
- [CustomDetailSpecification](https://developer.apple.com/documentation/realitykit/photogrammetrysession/configuration-swift.struct/customdetailspecification)
- [DispatchSource Signal Handling](https://developer.apple.com/documentation/dispatch/dispatchsource)
- [Swift Argument Parser](https://github.com/apple/swift-argument-parser)
- [WWDC21: Create 3D models with Object Capture](https://developer.apple.com/videos/play/wwdc2021/10076/)
