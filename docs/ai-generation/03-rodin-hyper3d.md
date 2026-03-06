# 03 - Rodin (Hyper3D)

## 1. Panoramica

Rodin di Hyper3D (DeemosTech) e il generatore 3D basato su intelligenza artificiale con la qualita piu alta attualmente disponibile sul mercato, con valutazioni nei benchmark comprese tra 8.5 e 9.5 su 10. Supporta tre modalita di generazione: text-to-3D, image-to-3D e multi-view input.

Rodin si distingue come leader indiscusso sia in termini di qualita che di velocita di generazione, offrendo materiali PBR accurati e texture ad alta risoluzione.

Riferimenti:

- API ufficiali: [https://developer.hyper3d.ai/](https://developer.hyper3d.ai/)
- Sito ufficiale: [https://hyper3d.ai/](https://hyper3d.ai/)

## 2. Autenticazione e API

L'accesso alle API richiede una API Key, utilizzata come Bearer token nell'header `Authorization` di ogni richiesta.

Caratteristiche dell'API:

- **Base URL**: `https://api.hyper3d.com/api/v2`
- **Protocollo**: RESTful
- **Workflow**: asincrono (submit task -> poll status -> download result)
- **Autenticazione**: Bearer token nell'header `Authorization`

Integrazioni disponibili:

| Integrazione | Descrizione |
|-------------|-------------|
| ComfyUI | Nodi nativi per workflow di generazione |
| fal.ai | Accesso tramite piattaforma fal.ai |

## 3. Tier di Generazione

Rodin offre diversi tier di generazione, ciascuno con caratteristiche e tempi differenti:

| Tier | Tempo | Caratteristiche |
|------|-------|----------------|
| **Gen-2** | ~90s | Polygon count regolabile, texture 2K, PBR material |
| **Sketch** | ~20s | Geometria base, texture 1K, low-poly, prototipazione rapida |
| **Regular** | ~70s | Polygon count regolabile, texture 2K |
| **Detail** | >70s | Dettagli migliorati rispetto a Regular |
| **Smooth** | >70s | Output piu pulito rispetto a Regular |

Opzione **High Pack**: disponibile per i tier Regular e superiori, abilita texture 4K e modelli high-poly.

## 4. Formati di Output

| Formato | Supporto | Note |
|---------|----------|------|
| GLB | Nativo | Unico formato disponibile per il tier Sketch, mesh triangolari |
| OBJ | Nativo | Disponibile per Regular/Detail/Smooth, mesh triangolari o quad |
| FBX | Nativo | Disponibile per Regular/Detail/Smooth |
| USDZ | Richiede conversione | Vedi `08-format-conversion.md` |

## 5. Workflow API Dettagliato

Il workflow di generazione si articola in tre fasi principali, basate sull'esempio minimo dalla documentazione ufficiale.

### Step 1 - Submit Task

Invio della richiesta di generazione tramite multipart form data:

```
POST https://api.hyper3d.com/api/v2/rodin
Content-Type: multipart/form-data
Authorization: Bearer <API_KEY>

Body:
- images: file immagine (o prompt testuale)
- tier: "Sketch" | "Regular" | "Detail" | "Smooth"
- mesh_mode: "Raw" (per Gen-2)
- quality_override: 500000 (polygon count)
- material: "PBR"
```

La risposta contiene un `subscription_key` e un `task_uuid` necessari per le fasi successive.

### Step 2 - Poll Status

Monitoraggio dello stato del task tramite polling ogni 5 secondi:

```
POST https://api.hyper3d.com/api/v2/status
Content-Type: application/json
Authorization: Bearer <API_KEY>

Body: { "subscription_key": "..." }
```

Il polling continua fino a quando lo status diventa `"Done"` o `"Failed"`. Lo status `"Running"` indica che la generazione e ancora in corso.

### Step 3 - Download

Scaricamento dei file risultanti una volta completata la generazione:

```
POST https://api.hyper3d.com/api/v2/download
Content-Type: application/json
Authorization: Bearer <API_KEY>

Body: { "task_uuid": "..." }
```

La risposta contiene una lista di file scaricabili, ciascuno con il proprio URL di download.

## 6. Qualita e Performance

- **Qualita complessiva**: leader assoluto nei benchmark con valutazioni tra 8.5 e 9.5 su 10
- **Texture**: PBR fino a 4K con opzione High Pack
- **Accuratezza**: superiore per foto prodotto e immagini fotorealistiche
- **Multi-view**: il supporto multi-view migliora ulteriormente l'accuratezza della ricostruzione
- **Material properties**: proprieta dei materiali catturate con elevata precisione

## 7. Integrazione con il Progetto

Rodin viene utilizzato come provider cloud all'interno del pattern `AIProcessManager`.

Il workflow di integrazione segue questi passaggi:

1. **Submit multipart**: invio della richiesta di generazione con immagine o prompt testuale
2. **Polling**: monitoraggio dello stato del task fino al completamento
3. **Download**: scaricamento dei file generati
4. **Conversione formato**: trasformazione nei formati richiesti dal progetto
5. **Upload R2**: caricamento dei risultati su Cloudflare R2

Configurazione richiesta:

- `RODIN_API_KEY` da inserire in `config.js`

Il provider supporta sia upload di immagini che prompt testuali come input di generazione.

Per l'architettura complessiva del sistema, fare riferimento a `09-architecture.md`.

## 8. Limiti e Considerazioni

- Costi piu alti rispetto a Tripo e Meshy, in linea con la qualita premium offerta
- Tempi di generazione piu lunghi per i tier Detail e Smooth
- Il tier Sketch e ideale per prototipazione rapida, mentre Regular e superiori sono indicati per la produzione
- Rate limits delle API da verificare nella documentazione ufficiale
- Il formato USDZ non e disponibile nativamente e richiede una fase di conversione

## 9. Esempio di Integrazione

Di seguito lo pseudo-code per un provider `RodinProvider` che incapsula l'interazione con le API Rodin:

```javascript
class RodinProvider {
  constructor(apiKey)

  async generate({ type, input, tier, options }) {
    // POST https://api.hyper3d.com/api/v2/rodin
    // multipart form data con immagine o prompt
    // type: 'text' | 'image'
    // tier: 'Sketch' | 'Regular' | 'Detail' | 'Smooth'
    // Restituisce: { subscriptionKey, taskUuid }
  }

  async checkStatus(subscriptionKey) {
    // POST https://api.hyper3d.com/api/v2/status
    // Poll ogni 5 secondi
    // Restituisce: { status: 'Done' | 'Failed' | 'Running', jobs: [...] }
  }

  async downloadResult(taskUuid, outputDir) {
    // POST https://api.hyper3d.com/api/v2/download
    // Download di tutti i file risultanti
    // Restituisce: percorso della directory di output
  }
}
```

## 10. Riferimenti

| Risorsa | Link |
|---------|------|
| Documentazione API | [https://developer.hyper3d.ai/](https://developer.hyper3d.ai/) |
| Sito ufficiale | [https://hyper3d.ai/](https://hyper3d.ai/) |
| Esempio minimo | [https://developer.hyper3d.ai/get-started/minimal-example](https://developer.hyper3d.ai/get-started/minimal-example) |
| Architettura del progetto | `09-architecture.md` |
