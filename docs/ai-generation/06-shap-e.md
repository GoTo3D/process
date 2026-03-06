# 06 - Shap-E

## 1. Panoramica

Shap-E e un modello generativo condizionale sviluppato da OpenAI per la creazione di oggetti 3D. A differenza di altri modelli open source che supportano esclusivamente la modalita image-to-3D, Shap-E e l'unico modello open source che supporta sia **text-to-3D** che **image-to-3D**, rendendolo una soluzione versatile per la prototipazione e l'esplorazione creativa.

Caratteristiche principali:

- **Licenza MIT**: completamente gratuito, nessuna API key richiesta
- **Text-to-3D e Image-to-3D**: unico modello open source con entrambe le modalita
- **Funzionamento offline**: dopo il download iniziale dei pesi, funziona senza connessione internet
- **Approccio generativo**: genera parametri impliciti (NeRF e mesh) di funzioni 3D

Riferimenti:

- GitHub: [https://github.com/openai/shap-e](https://github.com/openai/shap-e)
- Hugging Face: [https://huggingface.co/openai/shap-e](https://huggingface.co/openai/shap-e)

## 2. Requisiti Hardware

| Requisito | Minimo | Consigliato |
|-----------|--------|-------------|
| GPU | NVIDIA (richiesta CUDA) | GPU con 8GB+ VRAM |
| CPU | Multi-core moderno | Per rendering senza GPU (molto lento) |
| RAM | 16GB | 32GB |
| CUDA | Compatibile con PyTorch | Ultima versione stabile |
| Python | 3.8+ | 3.10 |
| Storage | ~5GB per modello + dipendenze | SSD |

**NOTA**: Shap-E e compatibile SOLO con GPU NVIDIA. Non funziona su Apple Silicon nativo. L'esecuzione su CPU e tecnicamente possibile ma estremamente lenta e sconsigliata per utilizzo pratico.

## 3. Setup e Installazione

Clonare il repository e installare il pacchetto:

```bash
git clone https://github.com/openai/shap-e.git
cd shap-e
pip install -e .
```

**Attenzione alle dipendenze**: OpenAI non documenta completamente le dipendenze richieste. L'installazione e nota per essere problematica e richiede la verifica manuale della compatibilita tra versioni.

Dipendenze principali:

- **PyTorch**: framework di deep learning (versione compatibile con la propria versione CUDA)
- **transformers**: libreria Hugging Face per i modelli
- **accelerate**: ottimizzazione inferenza GPU
- **diffusers**: versione specifica richiesta (verificare compatibilita dal repository GitHub)

Si consiglia di creare un virtual environment dedicato per evitare conflitti:

```bash
python -m venv shap-e-env
source shap-e-env/bin/activate
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu118
cd shap-e
pip install -e .
```

I pesi del modello vengono scaricati automaticamente da Hugging Face al primo utilizzo.

## 4. Utilizzo

### Text-to-3D

Generazione di un oggetto 3D a partire da un prompt testuale:

```python
import torch
from shap_e.diffusion.sample import sample_latents
from shap_e.diffusion.gaussian_diffusion import diffusion_from_config
from shap_e.models.download import load_model, load_config

device = torch.device('cuda')
xm = load_model('transmitter', device=device)
model = load_model('text300M', device=device)
diffusion = diffusion_from_config(load_config('diffusion'))

latents = sample_latents(
    batch_size=1,
    model=model,
    diffusion=diffusion,
    model_kwargs=dict(texts=['a red motorcycle']),
    guidance_scale=15.0,
    progress=True,
)
```

### Image-to-3D

Generazione di un oggetto 3D a partire da una singola immagine:

```python
import torch
from shap_e.diffusion.sample import sample_latents
from shap_e.diffusion.gaussian_diffusion import diffusion_from_config
from shap_e.models.download import load_model, load_config
from PIL import Image

device = torch.device('cuda')
xm = load_model('transmitter', device=device)
model = load_model('image300M', device=device)
diffusion = diffusion_from_config(load_config('diffusion'))

image = Image.open('input_image.png')

latents = sample_latents(
    batch_size=1,
    model=model,
    diffusion=diffusion,
    model_kwargs=dict(images=[image]),
    guidance_scale=3.0,
    progress=True,
)
```

### Esportazione Mesh

Dopo la generazione dei latent, e possibile estrarre la mesh:

```python
from shap_e.util.notebooks import decode_latent_mesh

for latent in latents:
    t = decode_latent_mesh(xm, latent).tri_mesh()
    with open('output.ply', 'wb') as f:
        t.write_ply(f)
    with open('output.obj', 'w') as f:
        t.write_obj(f)
```

## 5. Formati di Input

| Tipo | Formati | Note |
|------|---------|------|
| Testo | Prompt in inglese | Solo text-to-3D, prompt esclusivamente in lingua inglese |
| Singola immagine | PNG, JPG (PIL Image) | Solo image-to-3D |

Considerazioni per l'input:

- I prompt testuali devono essere in **inglese** (il modello non supporta altre lingue)
- Per image-to-3D, i migliori risultati si ottengono con oggetti isolati su sfondo pulito
- Non e supportato l'input multi-view (solo singola immagine)

## 6. Formati di Output

| Formato | Supporto |
|---------|----------|
| PLY | Nativo (point cloud e mesh) |
| STL | Nativo (mesh) |
| OBJ | Tramite conversione dal PLY/STL |
| USDZ | Richiede conversione (vedi `08-format-conversion.md`) |

Il formato nativo di output e PLY. Per l'integrazione con il progetto e necessaria una pipeline di conversione:

- **Visualizzazione**: compatibile con Blender (versione 3.3.1+)
- **Pipeline progetto**: PLY/STL → OBJ → USDZ (tramite gli strumenti di conversione descritti in `08-format-conversion.md`)

## 7. Qualita e Performance

| Aspetto | Valutazione |
|---------|-------------|
| Velocita | Minuti per generazione (significativamente piu lento di TripoSR/SPAR3D) |
| Qualita geometria | Base, adatta a prototipazione |
| Texture | Limitate, non PBR completo |
| Text-to-3D | Vantaggio unico tra modelli open source |
| Approccio | Diffusion-based (ottimizzazione iterativa) |

La qualita complessiva e inferiore rispetto sia ai servizi cloud che ai modelli open source piu recenti (TripoSR, SPAR3D). Tuttavia, Shap-E rimane rilevante per:

- Generazione text-to-3D senza costi (unico nel panorama open source)
- Prototipazione rapida e esplorazione creativa
- Scenari in cui il costo zero e prioritario rispetto alla qualita
- Utilizzo completamente offline

## 8. Integrazione con il Progetto

Shap-E viene utilizzato come provider self-hosted all'interno del pattern `AIProcessManager`. E l'unico provider open source che supporta la modalita text-to-3D.

Il workflow di integrazione segue questi passaggi:

1. **Ricezione input**: il sistema riceve un prompt testuale o un'immagine da processare
2. **Spawn processo Python**: viene avviato il processo Shap-E tramite subprocess
3. **Generazione PLY/STL**: il modello genera l'output nel formato nativo
4. **Conversione OBJ**: trasformazione del file PLY/STL in formato OBJ
5. **Conversione USDZ**: trasformazione del file OBJ in formato USDZ
6. **Upload R2**: caricamento dei risultati su Cloudflare R2

La pipeline di conversione e piu complessa rispetto ad altri provider (PLY → OBJ → USDZ anziche OBJ → USDZ diretto).

Configurazione richiesta in `config.js`:

| Variabile | Descrizione |
|-----------|-------------|
| `AI_MODELS_DIR` | Directory contenente il modello Shap-E |
| `AI_GPU_DEVICE` | Dispositivo GPU da utilizzare (es. `cuda:0`) |
| `AI_PYTHON_VENV` | Percorso al virtual environment Python |

Per l'architettura complessiva del sistema, fare riferimento a `09-architecture.md`.

## 9. Limiti e Considerazioni

- Qualita significativamente inferiore rispetto ai servizi cloud e ai modelli open source piu recenti
- Setup dipendenze problematico e poco documentato da parte di OpenAI
- Richiede GPU NVIDIA con CUDA (non funziona su Apple Silicon nativo)
- Tempi di generazione piu lunghi rispetto alle alternative (minuti anziche secondi)
- Modello non piu attivamente sviluppato da OpenAI
- Conversione formato aggiuntiva necessaria (PLY/STL → OBJ → USDZ)
- Prompt testuali supportati solo in lingua inglese
- Rischio di conflitti tra dipendenze Python durante l'installazione

## 10. Shap-E vs Alternative

| Aspetto | Shap-E | TripoSR | SPAR3D |
|---------|--------|---------|--------|
| Text-to-3D | Si | No | No |
| Image-to-3D | Si | Si | Si |
| Velocita | Minuti | <1s | <1s |
| Qualita | Base | Buona | Ottima |
| Setup | Problematico | Semplice | Medio |
| Costo | Gratuito | Gratuito | Gratuito |
| Licenza | MIT | MIT | Custom |
| Output nativo | PLY/STL | OBJ | OBJ |
| Sviluppo attivo | No | Limitato | Si |

Shap-E rappresenta la scelta obbligata quando si necessita di text-to-3D in modalita self-hosted. Per scenari esclusivamente image-to-3D, TripoSR o SPAR3D offrono risultati superiori in tempi significativamente inferiori.

Per la documentazione completa delle alternative:

- TripoSR: `04-triposr.md`
- Servizi cloud: `01-tripo-ai.md`, `02-meshy-ai.md`, `03-rodin-hyper3d.md`

## 11. Riferimenti

| Risorsa | Link |
|---------|------|
| GitHub | [https://github.com/openai/shap-e](https://github.com/openai/shap-e) |
| Hugging Face | [https://huggingface.co/openai/shap-e](https://huggingface.co/openai/shap-e) |
| Architettura del progetto | `09-architecture.md` |
| Conversione formati | `08-format-conversion.md` |
