# 04 - TripoSR

## 1. Panoramica

TripoSR e un modello open source per la ricostruzione 3D a partire da una singola immagine. Sviluppato congiuntamente da Stability AI e Tripo AI, rappresenta una soluzione self-hosted completamente gratuita per la generazione di mesh 3D tramite intelligenza artificiale.

Caratteristiche principali:

- **Licenza MIT**: completamente gratuito e open source
- **Velocita estrema**: generazione di una mesh 3D in meno di 1 secondo
- **Approccio feed-forward**: nessuna ottimizzazione iterativa, inferenza diretta
- **Modalita supportata**: solo image-to-3D (non supporta text-to-3D)

Riferimenti:

- GitHub: [https://github.com/VAST-AI-Research/TripoSR](https://github.com/VAST-AI-Research/TripoSR)
- Hugging Face: [https://huggingface.co/stabilityai/TripoSR](https://huggingface.co/stabilityai/TripoSR)

## 2. Requisiti Hardware

| Requisito | Minimo | Consigliato |
|-----------|--------|-------------|
| GPU | NVIDIA con 12GB VRAM | RTX 3080/4070 o superiore |
| RAM | 16GB | 32GB |
| Storage | 10GB per modello + dipendenze | SSD consigliato |
| OS | Linux (Ubuntu 20.04+) | Linux o macOS con GPU NVIDIA |
| CUDA | 11.8+ | 12.0+ |
| Python | 3.8+ | 3.10+ |

**NOTA**: TripoSR richiede una GPU NVIDIA con supporto CUDA. Non funziona su Apple Silicon senza adattamenti significativi.

## 3. Setup e Installazione

Clonare il repository e installare le dipendenze:

```bash
git clone https://github.com/VAST-AI-Research/TripoSR.git
cd TripoSR
pip install -r requirements.txt
```

Dipendenze principali:

- **PyTorch**: framework di deep learning (con supporto CUDA)
- **transformers**: libreria Hugging Face per il modello
- **accelerate**: ottimizzazione inferenza GPU
- **trimesh**: manipolazione mesh 3D

I pesi del modello vengono scaricati automaticamente da Hugging Face al primo avvio. Non e necessario alcun download manuale.

## 4. Utilizzo

Comando base per generare un modello 3D da un'immagine:

```bash
python run.py input_image.png --output-dir output/ --mc-resolution 256
```

Parametri configurabili:

| Parametro | Descrizione | Valori |
|-----------|-------------|--------|
| `--mc-resolution` | Risoluzione marching cubes | 128, 256, 512 |
| `--render` | Genera anche un rendering preview | Flag |
| `--no-remove-bg` | Non rimuovere lo sfondo automaticamente | Flag |

Risoluzioni piu alte producono mesh piu dettagliate ma richiedono piu VRAM e tempo di elaborazione.

## 5. Formati di Input

| Tipo | Formati | Note |
|------|---------|------|
| Singola immagine | PNG, JPG | Unica modalita supportata |

Considerazioni per l'input:

- La rimozione dello sfondo e integrata e automatica
- I migliori risultati si ottengono con oggetti isolati su sfondo pulito
- Non e supportato l'input multi-view (solo singola immagine)

## 6. Formati di Output

| Formato | Supporto |
|---------|----------|
| OBJ | Nativo |
| USDZ | Richiede conversione (vedi `08-format-conversion.md`) |

Il formato OBJ generato nativamente e direttamente compatibile con il progetto. Per ottenere il formato USDZ necessario al workflow completo, e richiesta una fase di conversione separata.

## 7. Qualita e Performance

| Aspetto | Valutazione |
|---------|-------------|
| Velocita | <1 secondo per generazione mesh |
| Qualita geometria | Buona per prototipazione |
| Texture | Base, non PBR completo |
| Approccio | Feed-forward (nessuna ottimizzazione iterativa) |

La qualita complessiva e inferiore rispetto alle API cloud premium, ma la velocita e l'assenza di costi ricorrenti rendono TripoSR ideale per:

- Prototipazione rapida
- Volumi di generazione alti senza costi per modello
- Scenari offline o con requisiti di privacy dei dati

## 8. Deployment

### Bare Metal

Installazione diretta su una macchina con GPU NVIDIA:

```bash
python -m venv triposr-env
source triposr-env/bin/activate
git clone https://github.com/VAST-AI-Research/TripoSR.git
cd TripoSR
pip install -r requirements.txt
```

### Docker

Esempio di Dockerfile base:

```dockerfile
FROM nvidia/cuda:12.0-devel-ubuntu22.04

RUN apt-get update && apt-get install -y python3 python3-pip git

RUN git clone https://github.com/VAST-AI-Research/TripoSR.git /app
WORKDIR /app
RUN pip install -r requirements.txt

ENTRYPOINT ["python3", "run.py"]
```

Per il deployment Docker e necessario il runtime `nvidia-docker` per esporre la GPU al container:

```bash
docker run --gpus all triposr-image input_image.png --output-dir /output
```

## 9. Integrazione con il Progetto

TripoSR viene utilizzato come provider self-hosted all'interno del pattern `AIProcessManager`.

Il workflow di integrazione segue questi passaggi:

1. **Ricezione immagine**: il sistema riceve l'immagine da processare
2. **Spawn processo Python**: viene avviato il processo TripoSR tramite subprocess
3. **Raccolta OBJ**: il file OBJ generato viene recuperato dalla directory di output
4. **Conversione USDZ**: trasformazione del file OBJ in formato USDZ
5. **Upload R2**: caricamento dei risultati su Cloudflare R2

Configurazione richiesta in `config.js`:

| Variabile | Descrizione |
|-----------|-------------|
| `AI_MODELS_DIR` | Directory contenente il modello TripoSR |
| `AI_GPU_DEVICE` | Dispositivo GPU da utilizzare (es. `cuda:0`) |
| `AI_PYTHON_VENV` | Percorso al virtual environment Python |

Per l'architettura complessiva del sistema, fare riferimento a `09-architecture.md`.

## 10. Limiti e Considerazioni

- Solo image-to-3D: non supporta la generazione da testo
- Richiede GPU NVIDIA con CUDA: non funziona su Apple Silicon nativo
- Qualita texture limitata rispetto ai servizi cloud premium
- Nessun supporto multi-view: accetta solo una singola immagine come input
- Rischio di OOM (Out Of Memory) con risoluzioni alte su GPU con VRAM limitata
- Richiede gestione attiva delle risorse GPU in ambienti di produzione

## 11. TripoSR vs Tripo AI (Cloud)

| Aspetto | TripoSR (Self-Hosted) | Tripo AI (Cloud) |
|---------|----------------------|------------------|
| Costo | Gratuito (solo hardware) | ~$0.20-0.40/modello |
| Velocita | <1 secondo | Variabile (10-90 secondi) |
| Qualita | Buona | Ottima |
| Text-to-3D | No | Si |
| Multi-view | No | Si |
| Hardware richiesto | GPU NVIDIA 12GB+ | Nessuno |
| Licenza | MIT | Proprietaria |
| Privacy dati | Completa (locale) | Dati inviati al cloud |
| Offline | Si | No |

Per la documentazione completa di Tripo AI come alternativa cloud, fare riferimento a `01-tripo-ai.md`.

## 12. Riferimenti

| Risorsa | Link |
|---------|------|
| GitHub | [https://github.com/VAST-AI-Research/TripoSR](https://github.com/VAST-AI-Research/TripoSR) |
| Hugging Face | [https://huggingface.co/stabilityai/TripoSR](https://huggingface.co/stabilityai/TripoSR) |
| Alternativa cloud (Tripo AI) | `01-tripo-ai.md` |
| Conversione formati | `08-format-conversion.md` |
| Architettura del progetto | `09-architecture.md` |
