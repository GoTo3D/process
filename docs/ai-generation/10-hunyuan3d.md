# 10 - Hunyuan3D

## 1. Panoramica

Hunyuan3D e un sistema avanzato di sintesi 3D su larga scala sviluppato da Tencent. Rappresenta uno dei modelli open source piu potenti disponibili per la generazione di modelli 3D tramite intelligenza artificiale, supportando sia la modalita **text-to-3D** che **image-to-3D** -- una combinazione rara nel panorama open source.

A differenza di altri modelli self-hosted che generano solo texture RGB di base, Hunyuan3D (dalla versione 2.1) e il primo modello open source a offrire texture **PBR production-ready** con mappe Albedo, Normal, Roughness e Metallic, UV-mapping seamless per tutti i canali e simulazione di materiali fisici.

Caratteristiche principali:

- **Text-to-3D e Image-to-3D**: tra i pochi modelli open source a supportare entrambe le modalita
- **Pipeline a due stadi**: generazione forma (shape) seguita da sintesi texture
- **PBR nativo (v2.1+)**: mappe Albedo, Normal, Roughness, Metallic con UV-mapping seamless
- **Compatibilita macOS**: a differenza della maggior parte dei modelli self-hosted
- **Licenza Apache-2.0**: uso commerciale consentito (con restrizioni in EU/UK/Corea del Sud)
- **Adozione**: piu di 150 aziende in Cina hanno integrato Hunyuan3D (Unity China, Bambu Lab, etc.)

Versioni principali:

- **2.0**: modello base completo con text-to-3D e image-to-3D
- **2.1**: PBR production-ready, giugno 2025
- **2.5**: miglioramenti del 72% nelle performance

Riferimenti:

- GitHub v2.0: [https://github.com/Tencent-Hunyuan/Hunyuan3D-2](https://github.com/Tencent-Hunyuan/Hunyuan3D-2)
- GitHub v2.1: [https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1](https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1)
- Sito ufficiale: [https://hunyuan-3d.com/](https://hunyuan-3d.com/)
- Hugging Face: [https://huggingface.co/tencent/Hunyuan3D-2](https://huggingface.co/tencent/Hunyuan3D-2)
- Replicate: [https://replicate.com/tencent/hunyuan3d-2](https://replicate.com/tencent/hunyuan3d-2)
- API cloud: 20 generazioni gratuite al giorno su Tencent Cloud

## 2. Varianti del Modello

### Versione 2.0

| Modello | Parametri | VRAM | Descrizione |
|---------|-----------|------|-------------|
| Hunyuan3D-2 | 1.1B | 16GB (shape+texture) | Modello base completo |
| Hunyuan3D-2mini | 0.6B | ~10GB | Versione leggera |
| Hunyuan3D-2mv | 1.1B | 16GB | Multi-view input |
| Hunyuan3D-2 Turbo | 1.1B | 16GB | Inferenza accelerata |
| Hunyuan3D-2 Fast | 1.1B | 16GB | Distilled, piu veloce |

### Versione 2.1

| Modello | Parametri | VRAM |
|---------|-----------|------|
| Hunyuan3D-Shape-v2-1 | 3.3B | 10GB (solo shape) |
| Hunyuan3D-Paint-v2-1 | 2B | 21GB (solo texture) |
| Totale pipeline v2.1 | - | 29GB |

La versione 2.1 introduce la generazione PBR nativa ma richiede significativamente piu VRAM rispetto alla v2.0.

## 3. Requisiti Hardware

| Requisito | v2.0 | v2.1 |
|-----------|------|------|
| GPU VRAM (shape) | 6GB | 10GB |
| GPU VRAM (texture) | 10GB | 21GB |
| GPU VRAM (totale) | 16GB | 29GB |
| Python | 3.10 | 3.10 |
| PyTorch | 2.5.1+cu124 | 2.5.1+cu124 |
| OS | Linux, Windows, macOS | Linux, Windows, macOS |

**NOTA IMPORTANTE**: Hunyuan3D supporta macOS, a differenza della maggior parte degli altri modelli self-hosted (TripoSR, SPAR3D, Shap-E, InstantMesh). Questo lo rende particolarmente adatto per l'integrazione con il progetto esistente, che gira esclusivamente su macOS.

## 4. Setup e Installazione

Clonare il repository e installare le dipendenze:

```bash
git clone https://github.com/Tencent-Hunyuan/Hunyuan3D-2.git
cd Hunyuan3D-2
pip install -r requirements.txt
pip install -e .
```

Dipendenze principali:

- **PyTorch**: framework di deep learning (versione 2.5.1 con supporto CUDA 12.4)
- **transformers**: libreria Hugging Face per i modelli
- **diffusers**: pipeline di diffusione
- **trimesh**: manipolazione mesh 3D

Setup aggiuntivo necessario per la pipeline di texture:

- **Custom rasterizer**: rasterizzatore personalizzato per la proiezione UV
- **Differentiable renderer**: renderer differenziabile per l'ottimizzazione texture
- **RealESRGAN** (opzionale): upscaling delle texture generate

Si consiglia di creare un virtual environment dedicato per evitare conflitti:

```bash
python -m venv hunyuan3d-env
source hunyuan3d-env/bin/activate
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu124
cd Hunyuan3D-2
pip install -r requirements.txt
pip install -e .
```

I pesi del modello vengono scaricati automaticamente da Hugging Face al primo utilizzo.

## 5. Formati di Input

| Tipo | Formati | Note |
|------|---------|------|
| Testo | Prompt in inglese | Text-to-3D |
| Singola immagine | PNG, JPG | Image-to-3D |
| Multiple immagini | PNG, JPG | Multi-view (modello mv) |

Considerazioni per l'input:

- I prompt testuali devono essere in **inglese** per risultati ottimali
- Per image-to-3D, i migliori risultati si ottengono con oggetti isolati su sfondo pulito
- Il modello multi-view (Hunyuan3D-2mv) accetta piu immagini dello stesso oggetto da angolazioni diverse

## 6. Formati di Output

| Formato | Supporto |
|---------|----------|
| GLB | Nativo (con texture PBR) |
| OBJ + MTL | Nativo |
| USDZ | Richiede conversione (vedi `08-format-conversion.md`) |

Texture maps generate (v2.1):

- **Albedo**: colore base del materiale
- **Normal**: dettagli geometrici di superficie
- **Roughness**: rugosita del materiale
- **Metallic**: proprieta metalliche del materiale

Per ottenere il formato USDZ necessario al workflow completo del progetto, e richiesta una fase di conversione separata tramite gli strumenti descritti in `08-format-conversion.md`.

## 7. Caratteristiche PBR (v2.1)

La versione 2.1 rappresenta una svolta significativa nel panorama dei modelli open source per la generazione 3D. Le caratteristiche PBR includono:

- **Primo modello open source con PBR production-ready**: nessun altro modello open source offre texture PBR native di qualita comparabile
- **Mappe complete**: genera Albedo, Normal, Roughness e Metallic in un'unica pipeline
- **UV-mapping seamless**: mapping UV automatico e coerente per tutti i canali texture
- **Simulazione materiali fisica**: riflessioni metalliche realistiche, subsurface scattering, rugosita variabile
- **Superiorita rispetto a v2.0**: le texture PBR di v2.1 sono significativamente superiori alla generazione texture RGB di v2.0 e di altri modelli open source

Queste caratteristiche rendono i modelli generati direttamente utilizzabili in pipeline di produzione senza necessita di ritocco manuale delle texture.

## 8. Opzioni di Utilizzo

### A. Python API (diffusers-like)

Generazione completa (shape + texture) tramite API Python:

```python
from hy3dgen.shapegen import Hunyuan3DDiTFlowMatchingPipeline
from hy3dgen.texgen import Hunyuan3DPaintPipeline

# Shape generation
shape_pipeline = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained(
    "tencent/Hunyuan3D-2"
)
mesh = shape_pipeline(image=image_or_text)

# Texture generation
paint_pipeline = Hunyuan3DPaintPipeline.from_pretrained(
    "tencent/Hunyuan3D-2"
)
textured_mesh = paint_pipeline(mesh, image=image)
textured_mesh.export("model.glb")
```

### B. Gradio Web UI

Interfaccia web integrata per utilizzo interattivo:

```bash
python app.py
```

La Web UI permette di caricare immagini o inserire prompt testuali e visualizzare i risultati direttamente nel browser.

### C. REST API Server

Server integrato per l'esposizione di API HTTP, utilizzabile per integrazioni programmatiche e servizi di backend.

### D. Blender Addon

Addon per l'integrazione diretta in Blender, che consente la generazione di modelli 3D direttamente all'interno dell'ambiente di modellazione.

## 9. Qualita e Performance

| Aspetto | Valutazione |
|---------|-------------|
| Velocita | 8-20 secondi (v2.5 su A100/RTX 4090) |
| Qualita geometria | Eccellente, tra le piu alte nei modelli open source |
| Texture PBR | Unico open source con texture PBR native production-ready |
| Risoluzione texture | 1024 (v2.5) vs 512 (v2.0) |
| Precisione geometrica | +15% in v2.5 rispetto a v2.0 |
| Text-to-3D | Supportato nativamente |
| Image-to-3D | Supportato nativamente |

La qualita complessiva e tra le migliori disponibili nel panorama open source. Le texture PBR native rendono i modelli direttamente utilizzabili in ambienti di produzione.

## 10. Hunyuan3D vs Alternative Open Source

| Aspetto | Hunyuan3D 2.1 | TripoSR | SPAR3D | Shap-E | InstantMesh |
|---------|---------------|---------|--------|--------|-------------|
| Text-to-3D | Si | No | No | Si | No |
| Image-to-3D | Si | Si | Si | Si | Si |
| PBR nativo | Si | No | No | No | No |
| Velocita | 8-20s | <1s | <1s | Minuti | 60-120s |
| VRAM (min) | 16GB (v2.0) | 12GB | 8GB | 8GB | 24GB |
| Qualita | Eccellente | Buona | Molto Buona | Base | Ottima |
| macOS | Si | No | No | No | No |
| Licenza | Apache-2.0** | MIT | Custom | MIT | Apache-2.0 |

** Restrizioni in EU/UK/Corea del Sud.

Hunyuan3D rappresenta la scelta ottimale quando si necessita di:

- Generazione text-to-3D e image-to-3D in un unico modello
- Texture PBR production-ready senza post-processing
- Compatibilita macOS per ambienti self-hosted
- Qualita eccellente con tempi di generazione contenuti

Per scenari in cui la velocita e prioritaria e non servono texture PBR, TripoSR o SPAR3D offrono tempi di generazione significativamente inferiori.

## 11. Integrazione con il Progetto

Hunyuan3D viene utilizzato come provider self-hosted all'interno del pattern `AIProcessManager`. Offre vantaggi unici rispetto alle altre alternative self-hosted.

Vantaggi specifici per questo progetto:

- **Compatibilita macOS**: come il progetto esistente che gira esclusivamente su macOS
- **Text-to-3D + Image-to-3D**: supporta entrambe le modalita in un unico modello
- **Texture PBR production-ready**: modelli utilizzabili direttamente senza ritocco

Il workflow di integrazione segue questi passaggi:

1. **Ricezione input**: il sistema riceve un prompt testuale o un'immagine da processare
2. **Spawn processo Python**: viene avviata la pipeline Hunyuan3D tramite subprocess
3. **Generazione shape**: la pipeline di shape generation produce la geometria 3D
4. **Generazione texture**: la pipeline di paint genera le texture PBR sulla mesh
5. **Raccolta GLB/OBJ**: il file generato viene recuperato dalla directory di output
6. **Conversione USDZ**: trasformazione in formato USDZ tramite `xcrun usdconvert`
7. **Upload R2**: caricamento dei risultati su Cloudflare R2

Modalita di deployment alternative:

- **REST API server integrato**: possibilita di avviare Hunyuan3D come servizio separato e comunicare via HTTP
- **ComfyUI**: integrazione tramite ComfyUI per pipeline visuale (vedi `11-comfyui-pipeline.md`)

Configurazione richiesta in `config.js`:

| Variabile | Descrizione |
|-----------|-------------|
| `AI_MODELS_DIR` | Directory contenente il modello Hunyuan3D |
| `AI_GPU_DEVICE` | Dispositivo GPU da utilizzare (es. `mps` su macOS, `cuda:0` su Linux) |
| `AI_PYTHON_VENV` | Percorso al virtual environment Python |

Per l'architettura complessiva del sistema, fare riferimento a `09-architecture.md`.

## 12. Limiti e Considerazioni

- VRAM alta richiesta: 16GB per la v2.0 e 29GB per la pipeline completa v2.1
- Restrizioni di licenza Apache-2.0 in EU/UK/Corea del Sud per uso commerciale
- Setup complesso: necessita di custom rasterizer e differentiable renderer
- Dipendenze pesanti: PyTorch, CUDA e numerose librerie Python
- La versione 2.1 richiede significativamente piu VRAM della v2.0, limitando l'hardware compatibile
- Tempi di generazione (8-20s) superiori rispetto a TripoSR e SPAR3D (<1s)
- I pesi del modello occupano diversi GB di spazio su disco

## 13. Riferimenti

| Risorsa | Link |
|---------|------|
| GitHub v2.0 | [https://github.com/Tencent-Hunyuan/Hunyuan3D-2](https://github.com/Tencent-Hunyuan/Hunyuan3D-2) |
| GitHub v2.1 | [https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1](https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1) |
| Hugging Face | [https://huggingface.co/tencent/Hunyuan3D-2](https://huggingface.co/tencent/Hunyuan3D-2) |
| Sito ufficiale | [https://hunyuan-3d.com/](https://hunyuan-3d.com/) |
| Replicate API | [https://replicate.com/tencent/hunyuan3d-2](https://replicate.com/tencent/hunyuan3d-2) |
| ComfyUI integration | `11-comfyui-pipeline.md` |
| Conversione formati | `08-format-conversion.md` |
| Architettura del progetto | `09-architecture.md` |
