# 11 - ComfyUI come Pipeline Orchestrator per Generazione 3D

## 1. Panoramica

ComfyUI e un motore AI visuale basato su nodi, progettato per orchestrare workflow di generazione video, immagini, modelli 3D e audio. Piuttosto che integrare ogni modello AI singolarmente nel codice del progetto (tramite `AIProcessManager` per ciascun provider), ComfyUI offre un approccio alternativo: un **orchestratore unificato** con interfaccia visuale per il design dei workflow e una REST API integrata per l'invocazione programmatica.

Grazie al sistema di nodi custom, ComfyUI supporta i principali modelli di generazione 3D gia analizzati in questa serie documentale: TripoSR, Tripo v3.0, Rodin Gen-2, Hunyuan3D, InstantMesh e molti altri.

Riferimenti:

- GitHub: [https://github.com/comfyanonymous/ComfyUI](https://github.com/comfyanonymous/ComfyUI)
- Sito ufficiale: [https://comfy.org](https://comfy.org)
- Documentazione: [https://docs.comfy.org](https://docs.comfy.org)

---

## 2. Architettura ComfyUI

ComfyUI opera come un server Python che espone una REST API sulla porta 8188. Internamente, ogni operazione e rappresentata come un nodo all'interno di un grafo. I nodi vengono connessi tra loro per formare un workflow completo, dalla ricezione dell'input fino alla produzione dei file di output.

```
                    +------------------+
                    |   ComfyUI Server |
                    |   (REST API)     |
                    |   Port 8188      |
                    +--------+---------+
                             |
              +--------------+--------------+
              |              |              |
     +--------v---+  +------v-----+  +-----v------+
     | Nodo       |  | Nodo       |  | Nodo       |
     | TripoSR    |  | Hunyuan3D  |  | Tripo API  |
     +--------+---+  +------+-----+  +-----+------+
              |              |              |
              v              v              v
         [OBJ/GLB]     [OBJ/GLB]      [GLB]
              |              |              |
              +--------------+--------------+
                             |
                    +--------v---------+
                    | Nodo Convert     |
                    | (Format Output)  |
                    +--------+---------+
                             |
                    +--------v---------+
                    | Output Files     |
                    +------------------+
```

Il server riceve richieste HTTP contenenti la definizione JSON del workflow (grafo dei nodi), lo esegue in sequenza risolvendo le dipendenze tra nodi, e rende disponibili i file di output tramite endpoint dedicati.

---

## 3. Nodi 3D Disponibili

La tabella seguente elenca i principali nodi nativi e community disponibili per la generazione 3D all'interno di ComfyUI.

| Nodo | Modello | Tipo | Fonte |
|------|---------|------|-------|
| TripoSR Node | TripoSR | Self-hosted | Community |
| Tripo v3.0 API | Tripo AI | Cloud API | Ufficiale |
| Rodin Gen-2 | Rodin / Hyper3D | Cloud API | Ufficiale |
| Hunyuan3D | Hunyuan3D | Self-hosted | Community (@visualbruno) |
| InstantMesh | InstantMesh | Self-hosted | Community |

I nodi cloud (Tripo v3.0 API, Rodin Gen-2) delegano la generazione alle rispettive API esterne e richiedono le relative API key. I nodi self-hosted (TripoSR, Hunyuan3D, InstantMesh) eseguono l'inferenza direttamente sulla GPU del server ComfyUI.

I nodi community si installano nella directory `custom_nodes/` del progetto ComfyUI e vengono caricati automaticamente all'avvio del server.

---

## 4. REST API di ComfyUI

ComfyUI espone una REST API completa sulla porta 8188 che consente di sottomettere workflow, monitorare lo stato di esecuzione e scaricare i risultati.

### 4.1 Submit di un Workflow

```bash
curl -X POST http://localhost:8188/prompt \
  -H "Content-Type: application/json" \
  -d '{"prompt": <workflow_json>, "client_id": "my-client"}'
```

La risposta contiene il `prompt_id` univoco assegnato al workflow sottomesso.

### 4.2 Controllo dello Stato

```bash
curl http://localhost:8188/history/<prompt_id>
```

La risposta include lo stato di avanzamento e, al completamento, i riferimenti ai file di output generati.

### 4.3 Download dell'Output

```bash
curl http://localhost:8188/view?filename=<output_file>&type=output
```

### 4.4 Flusso Operativo

Il workflow completo di interazione con la REST API segue questo schema:

```
1. Submit JSON del workflow (POST /prompt)
         |
         v
2. Ricevi prompt_id dalla risposta
         |
         v
3. Poll /history/<prompt_id> fino a completamento
         |
         v
4. Download file di output (GET /view?filename=...&type=output)
```

---

## 5. Modalita Headless / Server

ComfyUI puo essere avviato in modalita server senza interfaccia grafica, rendendolo adatto all'esecuzione su macchine remote o in container Docker.

### 5.1 Avvio Diretto

```bash
# Avvio server senza GUI
python main.py --listen 0.0.0.0 --port 8188 --dont-print-server
```

### 5.2 Avvio con Docker

```bash
# Con Docker e supporto GPU NVIDIA
docker run -d --gpus all -p 8188:8188 comfyui-server
```

### 5.3 Opzioni Principali

| Opzione | Descrizione |
|---------|-------------|
| `--listen 0.0.0.0` | Abilita l'accesso remoto al server (non solo localhost) |
| `--port 8188` | Porta personalizzabile per il server HTTP |
| `--dont-print-server` | Disabilita i log del server sulla console |
| `--gpu-only` | Forza l'utilizzo esclusivo della GPU |

Nessuna GUI e necessaria per l'utilizzo tramite API. Il server rimane in ascolto e processa le richieste HTTP in entrata.

---

## 6. Vantaggi dell'Approccio ComfyUI

La tabella seguente confronta l'approccio ComfyUI con l'integrazione diretta dei singoli provider tramite `AIProcessManager`.

| Aspetto | Integrazione Diretta | ComfyUI Pipeline |
|---------|---------------------|------------------|
| Setup per modello | Ogni modello ha setup diverso | Un solo setup ComfyUI |
| Aggiungere modelli | Codice nuovo per ogni provider | Installare nodo + creare workflow |
| Pipeline visuale | No | Si (debug e prototipazione visuale) |
| Conversione formati | Implementare in Node.js | Nodi di conversione disponibili |
| Manutenzione | N codebase separate | Una piattaforma unificata |
| Flessibilita | Alta (controllo totale) | Alta (composizione nodi) |
| Overhead | Basso | Medio (server aggiuntivo) |
| Dipendenze | Per modello | Centralizzate in ComfyUI |

L'approccio ComfyUI risulta particolarmente vantaggioso quando si intende sperimentare con molteplici modelli e workflow, poiche riduce drasticamente il tempo necessario per aggiungere un nuovo provider: e sufficiente installare il nodo corrispondente e configurare un workflow JSON.

---

## 7. Integrazione con il Progetto Esistente

Sono possibili due approcci per integrare ComfyUI con l'architettura del progetto descritta in `09-architecture.md`.

### 7.1 Approccio A: ComfyUI come Backend Unificato

In questo approccio, ComfyUI sostituisce completamente l'`AIProcessManager` e i singoli provider. Tutta la generazione AI viene delegata al server ComfyUI.

```
RabbitMQ --> processQueue.js --> ComfyUIProcessManager
                                        |
                                        v
                                  ComfyUI Server (REST API)
                                        |
                                        v
                                  Workflow 3D (nodi)
                                        |
                                        v
                                  Output files
                                        |
                                        v
                                  Upload R2 + Update DB
```

Il `processQueue.js` invia richieste alla REST API di ComfyUI invece di gestire direttamente i modelli. Il `ComfyUIProcessManager` si occupa di:

1. Caricare il workflow template appropriato
2. Iniettare i parametri del progetto
3. Sottomettere il workflow a ComfyUI
4. Attendere il completamento tramite polling
5. Scaricare l'output e caricarlo su R2

### 7.2 Approccio B: ComfyUI Affiancato (Ibrido)

In questo approccio, ComfyUI viene utilizzato solo per i modelli self-hosted, mantenendo le integrazioni dirette per le API cloud e la fotogrammetria invariata.

| Pipeline | Gestore | Note |
|----------|---------|------|
| Fotogrammetria | `ProcessManager` (invariato) | PhotoProcess / RealityKit Object Capture |
| AI cloud (Tripo, Meshy, Rodin) | `AIProcessManager` con chiamate API dirette | Come descritto in `09-architecture.md` |
| AI self-hosted (TripoSR, Hunyuan3D, InstantMesh) | `ComfyUIProcessManager` | ComfyUI orchestra i modelli locali |

Vantaggio: ogni approccio utilizza lo strumento piu adatto al contesto. Le API cloud non necessitano di ComfyUI poiche i relativi provider gestiscono gia l'orchestrazione lato server. ComfyUI viene impiegato dove aggiunge reale valore: la gestione unificata dei modelli locali.

---

## 8. Esempio ComfyUIProcessManager

Di seguito un esempio di implementazione del `ComfyUIProcessManager` che incapsula l'interazione con il server ComfyUI.

```javascript
class ComfyUIProcessManager {
  constructor(id, project, comfyuiUrl = 'http://localhost:8188') {
    this.id = id;
    this.project = project;
    this.comfyuiUrl = comfyuiUrl;
  }

  async process() {
    // 1. Carica workflow template per il provider richiesto
    const workflow = this.loadWorkflow(this.project.ai_provider);

    // 2. Inietta parametri (immagine input, prompt, opzioni)
    this.injectParams(workflow, this.project);

    // 3. Submit a ComfyUI
    const { prompt_id } = await this.submitWorkflow(workflow);

    // 4. Poll fino a completamento
    const result = await this.pollCompletion(prompt_id);

    // 5. Download output
    const outputPath = await this.downloadOutput(result);

    // 6. Upload su R2
    const model_urls = await uploadDir({ /* ... */ });

    // 7. Update status
    await updateProject(this.id, { status: 'done', model_urls });
  }

  async submitWorkflow(workflow) {
    const res = await fetch(`${this.comfyuiUrl}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow })
    });
    return res.json();
  }

  async pollCompletion(promptId, timeout = 300000) {
    // Poll /history/{promptId} ogni 2 secondi
    // Timeout dopo 5 minuti
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const res = await fetch(`${this.comfyuiUrl}/history/${promptId}`);
      const data = await res.json();
      if (data[promptId]?.status?.completed) {
        return data[promptId];
      }
      await new Promise(r => setTimeout(r, 2000));
    }
    throw new Error('ComfyUI workflow timeout');
  }

  async downloadOutput(result) {
    // Estrai filename dall'output del workflow
    // Download tramite GET /view?filename=...&type=output
  }

  loadWorkflow(provider) {
    // Carica il template JSON dalla directory workflows/
    const templatePath = path.join(__dirname, 'workflows', `${provider}.json`);
    return JSON.parse(fs.readFileSync(templatePath, 'utf-8'));
  }

  injectParams(workflow, project) {
    // Modifica i nodi del workflow con i parametri del progetto
    // Es: path immagine input, prompt testuale, opzioni di qualita
  }
}
```

Il pattern e analogo a quello del `ProcessManager` esistente (`src/ProcessManager.js`) e dell'`AIProcessManager` descritto in `09-architecture.md`: un orchestratore che coordina le fasi di generazione, download e upload.

---

## 9. Workflow Templates

I workflow ComfyUI sono file JSON che descrivono il grafo completo dei nodi da eseguire. Per ogni modello o caso d'uso, si predispone un template che viene caricato e parametrizzato dinamicamente dal `ComfyUIProcessManager`.

### 9.1 Struttura Directory

```
workflows/
  ├── triposr-image-to-3d.json
  ├── hunyuan3d-text-to-3d.json
  ├── hunyuan3d-image-to-3d.json
  ├── tripo-api-text-to-3d.json
  └── rodin-api-image-to-3d.json
```

### 9.2 Struttura di un Template

Ogni template JSON contiene la definizione dei nodi e delle connessioni tra essi. I valori parametrizzabili (path dell'immagine, prompt, opzioni) vengono sostituiti a runtime dal `ComfyUIProcessManager` prima della sottomissione al server.

I workflow possono essere creati visualmente tramite l'interfaccia grafica di ComfyUI e successivamente esportati come file JSON. Questo semplifica notevolmente la fase di prototipazione: si progetta il workflow nell'interfaccia visuale, lo si testa interattivamente, e poi lo si esporta come template per l'utilizzo via API.

---

## 10. Setup ComfyUI per il Progetto

### 10.1 Installazione

```bash
# 1. Clone del repository
git clone https://github.com/comfyanonymous/ComfyUI.git
cd ComfyUI
pip install -r requirements.txt

# 2. Installazione nodi 3D (nella directory custom_nodes)
cd custom_nodes
git clone <triposr-node-repo>
git clone <hunyuan3d-node-repo>

# 3. Download dei modelli
# I pesi dei modelli vanno posizionati nella directory models/
# Consultare la documentazione di ciascun nodo per i modelli richiesti

# 4. Avvio del server in modalita headless
python main.py --listen 0.0.0.0 --port 8188
```

### 10.2 Verifica del Funzionamento

Una volta avviato il server, verificare che risponda correttamente:

```bash
# Verifica che il server sia attivo
curl http://localhost:8188/system_stats

# Verifica che i nodi custom siano caricati
curl http://localhost:8188/object_info
```

---

## 11. Limiti e Considerazioni

- **Server aggiuntivo**: ComfyUI e un processo separato da gestire, con le relative esigenze di monitoraggio e manutenzione
- **Overhead HTTP**: la comunicazione tra `processQueue.js` e ComfyUI avviene tramite chiamate HTTP, aggiungendo latenza rispetto all'invocazione diretta di un processo Python
- **Nodi community**: la manutenzione dei nodi community non e garantita; un nodo potrebbe non essere aggiornato per supportare nuove versioni di ComfyUI o del modello sottostante
- **Complessita dei workflow JSON**: generare e modificare programmaticamente i workflow JSON puo risultare complesso, soprattutto per workflow articolati con molti nodi
- **GPU dedicata**: il server ComfyUI richiede una GPU dedicata per l'esecuzione dei modelli self-hosted
- **Debug**: la presenza di un livello intermedio (ComfyUI) tra il consumer e il modello AI aggiunge complessita al debugging in caso di errori

---

## 12. Quando Usare ComfyUI vs Integrazione Diretta

La scelta tra i due approcci dipende dalle esigenze specifiche del progetto.

**Usa ComfyUI se:**

- Si intende sperimentare con molti modelli diversi in fase di prototipazione
- Si preferisce un design visuale dei workflow per facilitare la comprensione e il debugging
- Si vuole un punto di gestione unico per tutti i modelli self-hosted
- Si prevede di combinare piu nodi in pipeline complesse (es. generazione + post-processing)

**Usa l'integrazione diretta se:**

- Si hanno 1-2 provider fissi e non si prevede di aggiungerne altri
- Si vuole controllo totale sul codice e sul ciclo di vita dei processi
- Si vuole minimizzare l'overhead infrastrutturale (nessun server aggiuntivo)
- Si preferisce un debugging diretto senza livelli intermedi

---

## 13. Riferimenti

| Risorsa | Link |
|---------|------|
| GitHub ComfyUI | [https://github.com/comfyanonymous/ComfyUI](https://github.com/comfyanonymous/ComfyUI) |
| Sito ufficiale | [https://comfy.org](https://comfy.org) |
| Documentazione | [https://docs.comfy.org](https://docs.comfy.org) |
| Tripo v3.0 su ComfyUI | [https://blog.comfy.org/p/generate-high-fidelity-3d-models](https://blog.comfy.org/p/generate-high-fidelity-3d-models) |
| TripoSR ComfyUI Guide | [https://www.triposrai.com/posts/triposr-comfyui-node-guide/](https://www.triposrai.com/posts/triposr-comfyui-node-guide/) |
| Architettura del progetto | [`09-architecture.md`](./09-architecture.md) |
| Conversione formati | [`08-format-conversion.md`](./08-format-conversion.md) |
| Panoramica generale | [`00-overview.md`](./00-overview.md) |
