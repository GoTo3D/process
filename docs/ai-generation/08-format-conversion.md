# 08 - Conversione Formati 3D

## 1. Panoramica

Il progetto esistente produce modelli 3D nei formati **OBJ**, **MTL** e **USDZ** tramite il tool `PhotoProcess`, che si basa sull'API Object Capture di Apple RealityKit. I modelli generati dai provider AI, tuttavia, producono output in formati diversi a seconda del provider utilizzato:

- **GLB/GLTF**: Tripo AI, Meshy AI, Rodin, SPAR3D, InstantMesh
- **OBJ**: TripoSR, InstantMesh, Tripo AI, Meshy AI, Rodin, SPAR3D
- **PLY/STL**: Shap-E

Per garantire compatibilita con la pipeline esistente e con il sistema di upload su Cloudflare R2, e necessaria una pipeline di conversione che normalizzi tutti gli output nel formato target: **OBJ + MTL + USDZ**.

---

## 2. Mappa Formati per Provider

La tabella seguente riassume i formati nativi di ciascun provider e le conversioni necessarie per allinearsi alla pipeline del progetto.

| Provider | Output Nativo | Conversione Necessaria |
|----------|--------------|----------------------|
| **Tripo AI** | GLB, FBX, OBJ | OBJ disponibile, USDZ da convertire |
| **Meshy AI** | GLB, OBJ, FBX, STL | OBJ disponibile, USDZ da convertire |
| **Rodin** | GLB, OBJ, FBX | OBJ disponibile, USDZ da convertire |
| **TripoSR** | OBJ | Solo USDZ da convertire |
| **SPAR3D** | GLB, OBJ | OBJ disponibile, USDZ da convertire |
| **Shap-E** | PLY, STL | PLY/STL → OBJ + OBJ → USDZ |
| **InstantMesh** | OBJ, GLB | Solo USDZ da convertire |

**Nota**: quando il provider offre OBJ come output nativo, e sempre preferibile richiederlo direttamente per evitare conversioni intermedie e potenziale perdita di qualita.

---

## 3. Pipeline GLB/GLTF → OBJ + MTL

Quando il provider fornisce solo GLB (ad esempio Tripo AI in modalita predefinita), e necessario convertire in OBJ + MTL. Sono disponibili diverse opzioni.

### Opzione A: gltf-pipeline (Node.js)

```bash
npm install gltf-pipeline
```

```javascript
const { glbToGltf } = require('gltf-pipeline');
const fs = require('fs');

const glbData = fs.readFileSync('model.glb');
const { gltf } = await glbToGltf(glbData);
// NOTA: gltf-pipeline converte GLB → GLTF
// Serve uno step aggiuntivo per estrarre la mesh in formato OBJ
```

**Limitazione**: `gltf-pipeline` converte esclusivamente da GLB a GLTF. Per ottenere un file OBJ e necessario un passaggio ulteriore, il che rende questa opzione meno diretta rispetto alle alternative.

### Opzione B: trimesh (Python) - CONSIGLIATA

```python
import trimesh

mesh = trimesh.load('model.glb')
mesh.export('model.obj')
# MTL e texture vengono estratti automaticamente
```

**trimesh** e la soluzione piu diretta per la conversione GLB → OBJ. Gestisce automaticamente l'estrazione delle texture e la generazione del file MTL.

### Opzione C: assimp (CLI)

```bash
# Installazione su macOS
brew install assimp

# Installazione su Linux
apt install assimp-utils

# Conversione
assimp export model.glb model.obj
```

`assimp` (Open Asset Import Library) e un tool da linea di comando che supporta un ampio numero di formati 3D. Utile come alternativa quando trimesh non e disponibile.

---

## 4. Pipeline PLY/STL → OBJ

Per **Shap-E**, che produce output in formato PLY o STL, la conversione verso OBJ segue un percorso analogo utilizzando trimesh.

```python
import trimesh

# Da PLY
mesh = trimesh.load('model.ply')
mesh.export('model.obj')

# Da STL
mesh = trimesh.load('model.stl')
mesh.export('model.obj')
```

**Nota**: i formati PLY e STL tipicamente non includono informazioni sulle texture o sui materiali. Il file OBJ risultante potrebbe quindi non avere un file MTL associato, oppure avere un MTL con materiale predefinito.

---

## 5. Pipeline OBJ → USDZ

Questo e il passaggio critico della pipeline: tutti i provider, indipendentemente dal formato di output nativo, devono alla fine produrre un file USDZ per garantire compatibilita con la pipeline esistente e con le applicazioni AR di Apple.

### Opzione A: xcrun usdconvert (macOS) - CONSIGLIATA

```bash
xcrun usdconvert model.obj model.usdz
```

Caratteristiche:

- Disponibile su macOS con Xcode Command Line Tools installati
- Il progetto gira gia su macOS, quindi e disponibile nativamente
- Supporta OBJ con MTL e texture associate
- Produce USDZ pienamente conforme alle specifiche Apple
- Soluzione piu affidabile per il nostro caso d'uso

### Opzione B: Reality Converter (macOS GUI)

App ufficiale Apple per la conversione interattiva di modelli 3D verso USDZ. **Non adatta** per una pipeline automatizzata, in quanto richiede interazione manuale.

### Opzione C: usdzconvert (Python - Apple)

```bash
# Download da Apple:
# https://developer.apple.com/augmented-reality/tools/
python usdzconvert model.obj model.usdz
```

Tool Python fornito da Apple come parte degli USDZ Tools. Alternativa valida a `xcrun usdconvert` su sistemi dove Xcode non e installato.

### Opzione D: ModelIO (Swift/macOS programmatico)

```swift
import ModelIO

let asset = MDLAsset(url: objURL)
try asset.export(to: usdzURL)
```

Questa opzione consente l'integrazione programmatica in Swift. Potrebbe essere implementata come estensione del tool `PhotoProcess` esistente o come tool Swift complementare dedicato alla conversione formati.

---

## 6. Pipeline Completa Consigliata

Il diagramma seguente illustra il flusso di conversione completo, dall'output del provider AI fino al formato target pronto per l'upload su R2.

```
AI Provider Output
      |
      v
  [GLB/PLY/STL/OBJ]
      |
      +-- Se OBJ ---------> OK, procedi direttamente
      |
      +-- Se GLB ---------> trimesh (Python) --> OBJ + MTL
      |
      +-- Se PLY/STL -----> trimesh (Python) --> OBJ
      |
      v
    [OBJ + MTL]
      |
      v
  xcrun usdconvert --> USDZ
      |
      v
  [OBJ + MTL + USDZ]
      |
      v
  Upload su Cloudflare R2
```

**Stack consigliato**:

| Fase | Tool | Motivo |
|------|------|--------|
| GLB/PLY/STL → OBJ | trimesh (Python) | Versatile, supporto ampio formati, gestione automatica texture |
| OBJ → USDZ | xcrun usdconvert (macOS) | Nativo, affidabile, conforme specifiche Apple |

---

## 7. Implementazione FormatConverter

Classe JavaScript che incapsula la logica di conversione e puo essere integrata nell'`AIProcessManager`.

```javascript
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs/promises');

class FormatConverter {
  constructor(outputDir) {
    this.outputDir = outputDir;
  }

  /**
   * Converte un file 3D in formato OBJ.
   * Dispatching basato sul formato di input.
   * @param {string} inputPath - Percorso del file sorgente
   * @param {string} format - Formato di input: 'glb', 'ply', 'stl', 'obj'
   * @returns {Promise<string>} Percorso del file OBJ risultante
   */
  async toOBJ(inputPath, format) {
    const outputPath = path.join(this.outputDir, 'model.obj');

    if (format === 'obj') {
      // Nessuna conversione necessaria, copia il file
      await fs.copyFile(inputPath, outputPath);
      return outputPath;
    }

    if (['glb', 'gltf', 'ply', 'stl'].includes(format)) {
      // Utilizza trimesh (Python) per la conversione
      return new Promise((resolve, reject) => {
        const script = `
import trimesh
mesh = trimesh.load('${inputPath}')
mesh.export('${outputPath}')
`;
        execFile('python3', ['-c', script], (error) => {
          if (error) reject(new Error(`Conversione ${format} → OBJ fallita: ${error.message}`));
          else resolve(outputPath);
        });
      });
    }

    throw new Error(`Formato non supportato: ${format}`);
  }

  /**
   * Converte un file OBJ in formato USDZ tramite xcrun usdconvert.
   * @param {string} objPath - Percorso del file OBJ
   * @returns {Promise<string>} Percorso del file USDZ risultante
   */
  async toUSDZ(objPath) {
    const usdzPath = path.join(this.outputDir, 'model.usdz');

    return new Promise((resolve, reject) => {
      execFile('xcrun', ['usdconvert', objPath, usdzPath], (error) => {
        if (error) reject(new Error(`Conversione OBJ → USDZ fallita: ${error.message}`));
        else resolve(usdzPath);
      });
    });
  }

  /**
   * Pipeline completa: converte qualsiasi formato supportato in OBJ + USDZ.
   * @param {string} inputPath - Percorso del file sorgente
   * @param {string} inputFormat - Formato di input
   * @returns {Promise<{objPath: string, usdzPath: string}>}
   */
  async convert(inputPath, inputFormat) {
    const objPath = await this.toOBJ(inputPath, inputFormat);
    const usdzPath = await this.toUSDZ(objPath);
    return { objPath, usdzPath };
  }
}

module.exports = FormatConverter;
```

---

## 8. Gestione Texture e Materiali

La gestione delle texture durante le conversioni richiede attenzione particolare per evitare perdita di qualita o informazioni.

| Formato | Gestione Texture |
|---------|-----------------|
| **GLB** | Texture embedded nel file binario. Vengono estratte automaticamente da trimesh durante la conversione |
| **OBJ + MTL** | Texture referenziate nel file MTL tramite percorsi relativi. Devono trovarsi nella stessa directory del file OBJ |
| **USDZ** | Texture embedded nel package. `xcrun usdconvert` le include automaticamente se presenti accanto al file OBJ |
| **PLY** | Puo contenere colori per vertice, ma generalmente non include texture UV-mapped |
| **STL** | Nessun supporto per texture o materiali |

**Raccomandazioni**:

- **Minimizzare le conversioni**: ogni passaggio intermedio puo degradare la qualita delle texture. Preferire sempre l'output OBJ nativo del provider quando disponibile
- **Texture PBR**: i materiali PBR (roughness, metallic, normal map) sono pienamente supportati in GLB/GLTF ma hanno supporto limitato in OBJ/MTL. Durante la conversione da GLB a OBJ, alcune mappe PBR potrebbero non essere preservate
- **Verifica post-conversione**: ispezionare sempre il modello convertito per assicurarsi che texture e materiali siano stati trasferiti correttamente

---

## 9. Dipendenze da Installare

### Python (per trimesh)

```bash
pip install trimesh[easy] numpy
```

Il pacchetto `trimesh[easy]` include le dipendenze opzionali per il supporto di formati aggiuntivi (GLB, PLY, STL).

### macOS (per usdconvert)

```bash
# Xcode Command Line Tools (se non gia installati)
xcode-select --install
```

`xcrun usdconvert` e disponibile nativamente su macOS con Xcode Command Line Tools. Poiche il progetto gira gia su macOS, questa dipendenza dovrebbe essere gia soddisfatta.

### Node.js (opzionale)

```bash
npm install gltf-pipeline
```

Necessario solo se si sceglie l'Opzione A per la conversione GLB → GLTF (non consigliata come soluzione principale).

---

## 10. Considerazioni

1. **Preferire OBJ nativo**: quando il provider AI offre OBJ come formato di output, richiederlo direttamente per evitare conversioni intermedie e preservare la massima qualita
2. **xcrun usdconvert e la scelta primaria per USDZ**: essendo un tool nativo Apple, produce file USDZ pienamente conformi alle specifiche, fondamentale per la compatibilita con AR Quick Look e le app iOS/macOS
3. **trimesh come Swiss Army knife**: per tutte le conversioni mesh (GLB → OBJ, PLY → OBJ, STL → OBJ), trimesh offre un'interfaccia unificata e affidabile
4. **Testare la qualita dell'output**: dopo ogni conversione, verificare che geometria, texture e materiali siano stati trasferiti correttamente. Modelli complessi possono presentare artefatti dopo conversioni multiple
5. **Texture PBR**: il formato OBJ/MTL ha supporto limitato per materiali PBR avanzati (roughness, metallic, normal). Informazioni PBR presenti nel GLB originale potrebbero andare perse durante la conversione
6. **Performance**: le conversioni tramite trimesh (Python) richiedono l'avvio di un processo Python esterno. Per volumi elevati, valutare l'implementazione di un servizio Python persistente o l'utilizzo di ModelIO in Swift

---

## 11. Riferimenti

- **trimesh**: [https://trimesh.org/](https://trimesh.org/)
- **gltf-pipeline**: [https://github.com/CesiumGS/gltf-pipeline](https://github.com/CesiumGS/gltf-pipeline)
- **assimp**: [https://github.com/assimp/assimp](https://github.com/assimp/assimp)
- **Apple USDZ Tools**: [https://developer.apple.com/augmented-reality/tools/](https://developer.apple.com/augmented-reality/tools/)
- **Architettura di integrazione**: [`09-architecture.md`](09-architecture.md)
