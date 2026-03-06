# 01 - Tripo AI

## 1. Panoramica

Tripo AI e una piattaforma cloud per la generazione di modelli 3D tramite intelligenza artificiale. Supporta la creazione di modelli a partire da testo (text-to-3D) e da immagini (image-to-3D), sia con singola immagine che con immagini multiple.

Sono disponibili quattro modelli di generazione:

| Modello | Caratteristiche principali | Velocita |
|---------|---------------------------|----------|
| **v1.4** | Veloce, texture realistiche | Alta |
| **v2.0** | Geometria leader del settore con materiali PBR | Media |
| **v2.5** | Bilanciato tra velocita e consistenza | Media |
| **v3.0** | Massima precisione, bordi netti | Bassa |

Funzionalita aggiuntive:

- **Animazione**: generazione automatica di animazioni sui modelli prodotti
- **Style transfer**: applicazione di stili predefiniti (cartoon, clay, steampunk)
- **Post-processing**: controllo del polycount e conversione mesh

Riferimenti:

- Sito ufficiale: [https://www.tripo3d.ai/](https://www.tripo3d.ai/)
- Piattaforma API: [https://platform.tripo3d.ai/](https://platform.tripo3d.ai/)

## 2. Autenticazione e API

L'accesso alle API richiede una API Key, ottenibile dalla piattaforma [platform.tripo3d.ai](https://platform.tripo3d.ai/).

Caratteristiche dell'API:

- **Protocollo**: RESTful
- **Workflow**: asincrono (submit task -> poll status -> download result)
- **Autenticazione**: API Key nell'header della richiesta

Plugin disponibili per integrazione diretta:

| Plugin | Piattaforma |
|--------|-------------|
| Blender | Disponibile su GitHub |
| Unity | Plugin ufficiale |
| ComfyUI | Nodo personalizzato |

## 3. Formati di Input

| Modalita | Descrizione | Note |
|----------|-------------|------|
| **Text-to-3D** | Descrizione testuale del modello desiderato | Prompt in linguaggio naturale |
| **Image-to-3D** | Singola immagine del soggetto | Rimozione automatica dello sfondo |
| **Multi-image** | Viste multiple (frontale, laterale, dall'alto) | Maggiore accuratezza nella ricostruzione |

## 4. Formati di Output

| Formato | Supporto |
|---------|----------|
| GLB/GLTF | Nativo |
| FBX | Nativo |
| OBJ | Nativo |
| USDZ | Richiede conversione (vedi `08-format-conversion.md`) |

## 5. Pricing

| Voce | Dettaglio |
|------|-----------|
| Costo per modello | ~$0.20-0.40 (tramite provider esterni come fal.ai) |
| Piani subscription | Disponibili su [tripo3d.ai/pricing](https://www.tripo3d.ai/pricing) |
| API pricing | Separato dai piani consumer |

## 6. Qualita e Performance

- Buona topologia dei modelli generati, particolarmente adatto per personaggi e creature
- Tempo di generazione variabile in base al modello selezionato (v1.4 piu veloce, v3.0 piu lento)

Accuratezza stimata per modalita di input:

| Modalita | Accuratezza |
|----------|-------------|
| Single image | 70-85% |
| Multi-image | 90-95% |

## 7. Integrazione con il Progetto

Tripo AI viene utilizzato come provider cloud all'interno del pattern `AIProcessManager`.

Il workflow di integrazione segue questi passaggi:

1. **Submit task**: invio della richiesta di generazione all'API Tripo
2. **Polling**: monitoraggio dello stato del task fino al completamento
3. **Download GLB**: scaricamento del modello generato in formato GLB
4. **Conversione**: trasformazione del file GLB nei formati OBJ e USDZ
5. **Upload R2**: caricamento dei risultati su Cloudflare R2

Configurazione richiesta:

- `TRIPO_API_KEY` da inserire in `config.js`

Per l'architettura complessiva del sistema, fare riferimento a `09-architecture.md`.

## 8. Limiti e Considerazioni

- Richiede connessione internet attiva per ogni generazione
- Costi ricorrenti legati all'utilizzo delle API
- La qualita del risultato varia in base al modello scelto e alla complessita del soggetto
- Rate limits delle API da verificare nella documentazione ufficiale
- I formati di output nativi (GLB, FBX, OBJ) richiedono una fase di conversione per ottenere il formato USDZ compatibile con il progetto

## 9. Esempio di Integrazione

Di seguito lo pseudo-code per un provider `TripoProvider` che incapsula l'interazione con le API Tripo:

```javascript
class TripoProvider {
  constructor(apiKey)

  async generate({ type, input, model }) {
    // POST verso l'API Tripo
    // type: 'text' | 'image'
    // input: stringa prompt o URL immagine
    // model: 'v1.4' | 'v2.0' | 'v2.5' | 'v3.0'
    // Restituisce: { taskId }
  }

  async checkStatus(taskId) {
    // GET stato del task
    // Restituisce: { status: 'running' | 'done' | 'failed', progress }
  }

  async downloadResult(taskId, outputDir) {
    // Download del file GLB
    // Restituisce: percorso del file di output
  }
}
```

## 10. Riferimenti

| Risorsa | Link |
|---------|------|
| Documentazione API | [https://platform.tripo3d.ai/](https://platform.tripo3d.ai/) |
| Pricing | [https://www.tripo3d.ai/pricing](https://www.tripo3d.ai/pricing) |
| TripoSR (alternativa open source) | `04-triposr.md` |
| Architettura del progetto | `09-architecture.md` |
