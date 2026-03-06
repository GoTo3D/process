# 05 - SPAR3D (Stable Point Aware 3D)

## 1. Panoramica

SPAR3D (Stable Point-Aware Reconstruction of 3D Objects from Single Images) e una soluzione open-source e self-hosted per la generazione di modelli 3D da singola immagine tramite intelligenza artificiale. Sviluppato da Stability AI e rilasciato a gennaio 2025, e stato annunciato in partnership con NVIDIA al CES.

L'architettura di SPAR3D e innovativa: combina un modello di diffusione per la generazione di point cloud con una fase di predizione mesh regressiva. Questo approccio consente di generare mesh 3D texturate e UV-unwrapped a partire da una singola immagine in meno di 1 secondo.

Caratteristiche distintive:

- **Velocita**: generazione completa in meno di 1 secondo
- **Editing real-time**: il point cloud generato puo essere modificato dall'utente prima della generazione della mesh
- **UV-unwrapping automatico**: la mesh prodotta e gia pronta per texturing e utilizzo downstream
- **Delighting integrato**: rimozione dell'illuminazione ambientale per asset neutrali, pronti per game engine e rendering

Riferimenti:

- GitHub: [https://github.com/Stability-AI/stable-point-aware-3d](https://github.com/Stability-AI/stable-point-aware-3d)
- Hugging Face: [https://huggingface.co/stabilityai/stable-point-aware-3d](https://huggingface.co/stabilityai/stable-point-aware-3d)
- Demo: [https://huggingface.co/spaces/stabilityai/stable-point-aware-3d](https://huggingface.co/spaces/stabilityai/stable-point-aware-3d)

## 2. Requisiti Hardware

| Requisito | Minimo | Consigliato |
|-----------|--------|-------------|
| GPU | NVIDIA con 8GB VRAM | RTX 3080/4070+ |
| RAM | 16GB | 32GB |
| CUDA | 11.8+ | 12.0+ |
| Python | 3.8+ | 3.10+ |

SPAR3D e compatibile con le NVIDIA RTX AI PCs.

## 3. Architettura del Modello

SPAR3D utilizza un'architettura unica a due fasi:

1. **Point Cloud Sampling**: un modello di diffusione genera un point cloud preciso a partire dall'immagine di input. Il point cloud risultante e editabile dall'utente, che puo modificare la forma prima di procedere alla fase successiva.
2. **Mesh Generation**: una fase di predizione regressiva genera la mesh UV-unwrapped a partire dal point cloud. Questa fase include il delighting automatico.

Vantaggi dell'architettura:

- **Point cloud editabile**: l'utente puo intervenire sulla geometria intermedia prima della generazione della mesh finale, offrendo un controllo diretto sulla forma del modello
- **UV-unwrapping automatico**: la mesh generata e gia pronta per texturing e utilizzo in pipeline di produzione
- **Delighting integrato**: l'illuminazione ambientale viene rimossa automaticamente, producendo asset neutrali ideali per game engine e ambienti di rendering

## 4. Setup e Installazione

```bash
git clone https://github.com/Stability-AI/stable-point-aware-3d.git
cd stable-point-aware-3d
pip install -r requirements.txt
```

Dipendenze principali:

- PyTorch
- transformers
- diffusers
- trimesh

I pesi del modello vengono scaricati automaticamente da Hugging Face al primo avvio.

## 5. Formati di Input

| Modalita | Descrizione | Note |
|----------|-------------|------|
| **Image-to-3D** | Singola immagine del soggetto | PNG, JPG |
| **Point cloud editing** | Modifica del point cloud generato | Opzionale, prima della generazione mesh |

SPAR3D supporta esclusivamente la modalita image-to-3D. Non e disponibile la generazione da testo (text-to-3D).

## 6. Formati di Output

| Formato | Supporto | Note |
|---------|----------|------|
| GLB | Nativo | Mesh texturata UV-unwrapped |
| OBJ | Nativo | Mesh con texture |
| USDZ | Richiede conversione | Vedi `08-format-conversion.md` |

## 7. Qualita e Performance

- **Velocita**: meno di 1 secondo per generazione completa
- **Qualita**: superiore per oggetti singoli, con geometria e texture accurate
- **UV-unwrapping automatico**: vantaggio significativo rispetto a TripoSR, la mesh e immediatamente utilizzabile per texturing
- **Delighting**: gli asset generati sono pronti per l'inserimento in game engine senza necessita di post-processing dell'illuminazione
- **Editing point cloud**: possibilita di intervenire sulla forma prima della generazione finale, offrendo un livello di controllo non disponibile in altri modelli feed-forward

## 8. Differenze vs TripoSR

| Aspetto | SPAR3D | TripoSR |
|---------|--------|---------|
| Architettura | Point cloud diffusion + mesh regressiva | Feed-forward mesh diretta |
| UV-unwrap | Automatico | No |
| Editing intermedio | Point cloud editabile | No |
| Delighting | Si | No |
| VRAM richiesta | 8GB+ | 12GB+ |
| Licenza | Custom (verificare per uso commerciale) | MIT |
| Qualita output | Superiore | Buona |
| Velocita | <1 secondo | ~1 secondo |

SPAR3D rappresenta un'evoluzione rispetto a TripoSR, offrendo UV-unwrapping automatico, delighting integrato e la possibilita di editare il point cloud intermedio. TripoSR mantiene il vantaggio della licenza MIT e di requisiti hardware leggermente diversi.

Per un confronto dettagliato con TripoSR, fare riferimento a `04-triposr.md`.

## 9. Integrazione con il Progetto

SPAR3D viene utilizzato come provider self-hosted all'interno del pattern `AIProcessManager`.

Il workflow di integrazione segue questi passaggi:

1. **Input immagine**: ricezione dell'immagine sorgente
2. **Generazione point cloud**: esecuzione del modello di diffusione per ottenere il point cloud
3. **Editing point cloud** (opzionale): modifica del point cloud prima della generazione mesh
4. **Generazione mesh**: predizione regressiva della mesh UV-unwrapped
5. **Conversione formato**: trasformazione in USDZ tramite pipeline di conversione
6. **Upload R2**: caricamento dei risultati su Cloudflare R2

Configurazione richiesta:

- `AI_MODELS_DIR` in `config.js` per il percorso dei modelli
- `AI_GPU_DEVICE` in `config.js` per la configurazione della GPU

Per l'architettura complessiva del sistema, fare riferimento a `09-architecture.md`.

## 10. Limiti e Considerazioni

- Supporta esclusivamente la modalita image-to-3D (no text-to-3D)
- Richiede GPU NVIDIA con supporto CUDA
- L'editing del point cloud e una funzionalita interattiva, non facilmente automatizzabile in una pipeline batch
- La licenza e custom e va verificata per l'utilizzo commerciale (non e MIT come TripoSR)
- Progetto relativamente nuovo (rilasciato a gennaio 2025), la stabilita e la documentazione potrebbero evolversi nel tempo
- Non disponibile su macOS senza GPU NVIDIA

## 11. Riferimenti

| Risorsa | Link |
|---------|------|
| GitHub | [https://github.com/Stability-AI/stable-point-aware-3d](https://github.com/Stability-AI/stable-point-aware-3d) |
| Hugging Face Model | [https://huggingface.co/stabilityai/stable-point-aware-3d](https://huggingface.co/stabilityai/stable-point-aware-3d) |
| Demo interattiva | [https://huggingface.co/spaces/stabilityai/stable-point-aware-3d](https://huggingface.co/spaces/stabilityai/stable-point-aware-3d) |
| Paper | [https://spar3d.github.io/](https://spar3d.github.io/) |
| Confronto con TripoSR | `04-triposr.md` |
| Architettura del progetto | `09-architecture.md` |
