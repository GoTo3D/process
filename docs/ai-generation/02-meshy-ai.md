# 02 - Meshy AI

## 1. Panoramica

Meshy AI e il generatore 3D basato su intelligenza artificiale piu veloce attualmente disponibile sul mercato, con tempi di generazione compresi tra 30 e 60 secondi.

Funzionalita principali:

- **Text-to-3D**: generazione di modelli 3D a partire da descrizioni testuali
- **Image-to-3D**: generazione da singola immagine
- **Multi-Image-to-3D**: generazione da immagini multiple per maggiore accuratezza
- **Retexture**: ri-texturizzazione di modelli esistenti
- **Remesh**: ottimizzazione della mesh
- **Rigging & Animation**: rigging automatico e animazione dei modelli

Meshy espone un'API RESTful con documentazione completa.

- **Base URL**: `https://api.meshy.ai`
- **Documentazione**: [https://docs.meshy.ai](https://docs.meshy.ai)

## 2. Autenticazione e API

- E richiesta una **API Key**, ottenibile dalla pagina [meshy.ai/settings/api](https://www.meshy.ai/settings/api)
- API RESTful standard con risposte in formato JSON
- Supporto **Webhook** per ricevere notifiche al completamento dei task (tramite POST request)
- L'accesso API e disponibile per utenti con piano **Pro tier** e superiore

## 3. Formati di Input

| Modalita | Input | Note |
|---|---|---|
| **Text-to-3D** | Descrizione testuale | Processo in 2 step: generazione mesh + raffinamento texture |
| **Image-to-3D** | Singola immagine | Upload diretto dell'immagine |
| **Multi-Image-to-3D** | Immagini multiple | Maggiore accuratezza grazie a viste multiple |

## 4. Formati di Output

I formati di output supportati sono:

- **GLB / GLTF**
- **OBJ**
- **FBX**
- **STL**

Per la conversione in formato **USDZ**, fare riferimento a `08-format-conversion.md`.

## 5. Pricing (Sistema a Crediti)

Meshy utilizza un sistema di pricing basato su crediti (pay-before-you-go).

| Operazione | Crediti |
|---|---|
| Text to 3D (mesh) - Meshy-6/low-poly | 20 |
| Text to 3D (mesh) - altri modelli | 5 |
| Text to 3D (texture refinement) | 10 |
| Image to 3D - Meshy-6 | 20-30 |
| Image to 3D - altri modelli | 5-15 |
| Multi Image to 3D | come Image to 3D |
| Retexture | 10 |
| Remesh | 5 |
| Auto-Rigging | 5 |
| Animation | 3 |

Considerazioni sul pricing:

- **Nessun free tier** disponibile per l'utilizzo API
- Volume pricing disponibile contattando il team sales
- **Asset retention**: 3 giorni per utenti non-Enterprise (scaricare i risultati tempestivamente)

## 6. Workflow API

Il flusso di lavoro tipico tramite API segue questi passaggi:

1. **Creazione task**: inviare una richiesta `POST` per creare un task (text-to-3D o image-to-3D)
2. **Monitoraggio stato**: effettuare polling sullo status endpoint oppure configurare un webhook per ricevere notifiche
3. **Download risultato**: scaricare il modello 3D una volta completata la generazione
4. **Raffinamento texture** (opzionale, solo per text-to-3D): step aggiuntivo per migliorare la qualita delle texture

## 7. Qualita e Performance

- **Velocita**: generazione molto rapida, tipicamente tra 30 e 60 secondi
- **Qualita generale**: buona per la maggior parte dei casi d'uso
- **Modelli Meshy-6**: offrono qualita superiore ma richiedono piu crediti
- **Punto di forza principale**: velocita e consistenza dei risultati

## 8. Integrazione con il Progetto

Meshy AI si integra nel progetto come **provider cloud** all'interno del pattern `AIProcessManager`.

- Supporta webhook come alternativa al polling per il monitoraggio dei task
- **Workflow di integrazione**:
  1. Creazione del task tramite API
  2. Polling dello stato o ricezione webhook
  3. Download del modello generato
  4. Conversione nel formato desiderato (se necessario)
  5. Upload su Cloudflare R2
- **Configurazione richiesta**: `MESHY_API_KEY` in `config.js`
- Per l'architettura complessiva, fare riferimento a `09-architecture.md`

## 9. Limiti e Considerazioni

- Il **costo dei crediti** puo scalare rapidamente per volumi elevati di generazione
- **Asset retention di 3 giorni**: i risultati devono essere scaricati tempestivamente per evitare la perdita dei dati
- E richiesto il **piano Pro** (o superiore) per l'accesso alle API
- Sono presenti **rate limits**; consultare la documentazione ufficiale per i dettagli specifici

## 10. Esempio di Integrazione

```javascript
class MeshyProvider {
  constructor(apiKey)
  async generate({ type, input, options }) {
    // POST https://api.meshy.ai/v1/text-to-3d  (or image-to-3d)
    // Returns: { taskId }
  }
  async checkStatus(taskId) {
    // GET https://api.meshy.ai/v1/text-to-3d/{taskId}
    // Returns: { status, progress, model_url }
  }
  async downloadResult(taskId, outputDir) {
    // Download model file from model_url
    // Returns: output file path
  }
}
```

## 11. Riferimenti

- **Documentazione**: [https://docs.meshy.ai](https://docs.meshy.ai)
- **Pricing API**: [https://docs.meshy.ai/en/api/pricing](https://docs.meshy.ai/en/api/pricing)
- **Pagina API**: [https://www.meshy.ai/api](https://www.meshy.ai/api)
- **Architettura progetto**: `09-architecture.md`
