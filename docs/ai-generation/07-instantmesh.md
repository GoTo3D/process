# 07 - InstantMesh

## 1. Panoramica

InstantMesh e un modello open source per la generazione di mesh 3D a partire da una singola immagine, sviluppato da Tencent ARC. A differenza di approcci feed-forward come TripoSR, InstantMesh utilizza una pipeline a due fasi basata sulla generazione multi-view: prima genera viste multiple dell'oggetto da angolazioni diverse, poi ricostruisce la mesh 3D combinando queste viste.

Caratteristiche principali:

- **Licenza Apache-2.0**: open source con uso commerciale consentito
- **Approccio multi-view**: genera N viste dell'oggetto prima della ricostruzione, ottenendo una geometria superiore
- **Qualita geometrica**: significativamente migliore rispetto a TripoSR grazie alla visione multi-angolare
- **Modalita supportata**: solo image-to-3D (non supporta text-to-3D)

Riferimenti:

- GitHub: [https://github.com/TencentARC/InstantMesh](https://github.com/TencentARC/InstantMesh)

## 2. Requisiti Hardware

| Requisito | Minimo | Consigliato |
|-----------|--------|-------------|
| GPU | NVIDIA con 24GB VRAM | RTX 3090/4090 |
| RAM | 32GB | 64GB |
| CUDA | 11.8+ | 12.0+ |
| Python | 3.8+ | 3.10+ |
| Storage | 15GB+ per modello e dipendenze | SSD |

**NOTA**: I requisiti VRAM sono significativamente piu alti rispetto a TripoSR (24GB vs 12GB). Questo e dovuto alla pipeline multi-view che richiede il modello di diffusione per la generazione delle viste e il modello di ricostruzione per la mesh.

## 3. Architettura del Modello

InstantMesh opera attraverso una pipeline a due fasi distinte:

### Fase 1 - Multi-View Generation

A partire da una singola immagine di input, un modello di diffusione genera N viste dell'oggetto da angolazioni diverse. Questo passaggio permette di "vedere" l'oggetto da piu prospettive, colmando le informazioni mancanti nella singola immagine originale.

### Fase 2 - Mesh Reconstruction

Le viste multiple generate nella fase precedente vengono combinate per ricostruire una mesh 3D con geometria accurata. La disponibilita di informazioni da piu angolazioni consente una ricostruzione molto piu precisa.

Vantaggi dell'approccio multi-view rispetto al feed-forward:

- **Geometria piu accurata**: il modello osserva l'oggetto da piu angolazioni prima di ricostruire
- **Meno artefatti posteriori**: la generazione delle viste posteriori riduce gli artefatti tipici della ricostruzione da singola immagine
- **Migliore coerenza**: le viste generate sono coerenti tra loro, producendo una mesh piu uniforme

## 4. Setup e Installazione

Clonare il repository e installare le dipendenze:

```bash
git clone https://github.com/TencentARC/InstantMesh.git
cd InstantMesh
pip install -r requirements.txt
```

Dipendenze principali:

- **PyTorch**: framework di deep learning (con supporto CUDA)
- **diffusers**: libreria Hugging Face per il modello di diffusione multi-view
- **transformers**: libreria Hugging Face per i componenti del modello
- **trimesh**: manipolazione mesh 3D
- **rembg**: rimozione automatica dello sfondo

I pesi del modello vengono scaricati automaticamente da Hugging Face al primo avvio. Non e necessario alcun download manuale.

## 5. Formati di Input

| Tipo | Formati | Note |
|------|---------|------|
| Singola immagine | PNG, JPG | Unica modalita supportata |

Considerazioni per l'input:

- La rimozione dello sfondo e integrata e automatica tramite rembg
- I migliori risultati si ottengono con oggetti singoli ben definiti su sfondo pulito
- Non e supportato l'input testuale (solo image-to-3D)

## 6. Formati di Output

| Formato | Supporto |
|---------|----------|
| OBJ | Nativo (mesh con texture) |
| GLB | Nativo |
| USDZ | Richiede conversione (vedi `08-format-conversion.md`) |

Il formato OBJ generato nativamente e direttamente compatibile con il progetto. Per ottenere il formato USDZ necessario al workflow completo, e richiesta una fase di conversione separata.

## 7. Qualita e Performance

| Aspetto | Valutazione |
|---------|-------------|
| Velocita | 60-120 secondi per generazione mesh |
| Qualita geometria | Ottima, superiore a TripoSR |
| Texture | Buona qualita |
| Approccio | Multi-view (diffusione + ricostruzione) |
| Punto di forza | Geometria accurata grazie alla visione multi-angolare |

La velocita e significativamente inferiore rispetto a TripoSR (60-120s vs <1s), ma la qualita geometrica e nettamente superiore. InstantMesh e ideale per scenari dove la geometria e critica e la velocita non e il fattore primario.

## 8. InstantMesh vs Alternative

| Aspetto | InstantMesh | TripoSR | SPAR3D | Shap-E |
|---------|-------------|---------|--------|--------|
| Approccio | Multi-view | Feed-forward | Point cloud | Diffusion |
| Qualita geometria | Ottima | Buona | Molto buona | Base |
| Velocita | 60-120s | <1s | <1s | Minuti |
| VRAM | 24GB | 12GB | 8GB | 8GB+ |
| Text-to-3D | No | No | No | Si |
| Licenza | Apache-2.0 | MIT | Custom | MIT |
| Uso commerciale | Si | Si | Verificare | Si |

InstantMesh si posiziona come la scelta migliore quando la qualita geometrica e prioritaria rispetto alla velocita. TripoSR rimane preferibile per prototipazione rapida e volumi elevati.

## 9. Integrazione con il Progetto

InstantMesh viene utilizzato come provider self-hosted all'interno del pattern `AIProcessManager`.

Il workflow di integrazione segue questi passaggi:

1. **Ricezione immagine**: il sistema riceve l'immagine da processare
2. **Spawn processo Python**: viene avviato InstantMesh tramite subprocess
3. **Generazione multi-view**: il modello di diffusione genera le viste multiple dell'oggetto
4. **Ricostruzione mesh**: le viste vengono combinate per produrre il file OBJ
5. **Conversione USDZ**: trasformazione del file OBJ in formato USDZ
6. **Upload R2**: caricamento dei risultati su Cloudflare R2

Configurazione richiesta in `config.js`:

| Variabile | Descrizione |
|-----------|-------------|
| `AI_MODELS_DIR` | Directory contenente il modello InstantMesh |
| `AI_GPU_DEVICE` | Dispositivo GPU da utilizzare (es. `cuda:0`) |

Considerazioni operative:

- Richiede hardware piu potente rispetto a TripoSR (RTX 3090/4090)
- Timeout piu lungo necessario per il processing (2-3 minuti)
- La pipeline multi-step richiede piu spazio disco temporaneo per le viste intermedie

Per l'architettura complessiva del sistema, fare riferimento a `09-architecture.md`.

## 10. Limiti e Considerazioni

- VRAM molto alta richiesta (24GB minimo), limita le GPU compatibili
- Solo image-to-3D: non supporta la generazione da testo
- Tempo di generazione significativo (60-120 secondi per modello)
- Richiede GPU NVIDIA con CUDA: non funziona su Apple Silicon nativo
- Pipeline multi-step piu complessa rispetto ad approcci feed-forward
- Costo hardware elevato: le GPU con 24GB+ VRAM (RTX 3090/4090) hanno un costo significativo
- Maggiore consumo di spazio disco temporaneo per le viste intermedie

## 11. Casi d'Uso Consigliati

InstantMesh e la scelta ideale nei seguenti scenari:

- **Geometria accurata fondamentale**: oggetti dove la precisione geometrica e il requisito primario
- **Stampa 3D**: modelli destinati alla stampa 3D dove la geometria deve essere corretta da ogni angolazione
- **Asset per giochi e rendering**: scenari dove il retro dell'oggetto e visibile e deve essere accurato
- **Qualita su velocita**: quando la qualita del risultato prevale sul tempo di generazione

Per scenari dove la velocita e prioritaria o i volumi sono elevati, considerare TripoSR come alternativa (vedi `04-triposr.md`).

## 12. Riferimenti

| Risorsa | Link |
|---------|------|
| GitHub | [https://github.com/TencentARC/InstantMesh](https://github.com/TencentARC/InstantMesh) |
| Confronto con TripoSR | `04-triposr.md` |
| Architettura del progetto | `09-architecture.md` |
| Conversione formati | `08-format-conversion.md` |
