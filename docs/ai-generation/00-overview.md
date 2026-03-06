# 00 - Panoramica e Matrice Comparativa: Generazione 3D tramite AI

## 1. Introduzione

Questo documento introduce la **generazione 3D tramite intelligenza artificiale** come approccio complementare alla fotogrammetria esistente basata su RealityKit Object Capture.

Il progetto attualmente supporta la ricostruzione 3D tramite **fotogrammetria**: un processo che richiede un elevato numero di fotografie scattate da angolazioni diverse per ricostruire fedelmente un oggetto fisico reale. Questo approccio produce risultati di altissima qualita, ma presenta limiti intrinseci: necessita di molte immagini, tempi di elaborazione significativi e la possibilita di operare esclusivamente su oggetti fisicamente esistenti.

La **generazione 3D tramite AI** supera alcune di queste limitazioni. E in grado di generare modelli tridimensionali a partire da una singola immagine o persino da una descrizione testuale. I tempi di elaborazione sono drasticamente ridotti (da secondi a pochi minuti), ed e possibile creare modelli di oggetti immaginari o non ancora realizzati. Di contro, la qualita del risultato e generalmente inferiore rispetto alla fotogrammetria tradizionale.

Il progetto supportera **entrambi gli approcci** attraverso la stessa pipeline architetturale:

```
Coda AMQP --> ProcessManager / AIProcessManager --> Upload R2
```

Questa scelta consente di riutilizzare l'infrastruttura esistente (RabbitMQ, Cloudflare R2, Supabase, Telegram) aggiungendo un nuovo percorso di elaborazione dedicato ai modelli AI.

---

## 2. Fotogrammetria vs Generazione AI

La tabella seguente mette a confronto i due approcci principali supportati dal progetto.

| Aspetto | Fotogrammetria (attuale) | AI Generation (nuovo) |
|---|---|---|
| **Input** | 20-200 foto da angolazioni diverse | 1 foto o testo |
| **Tempo di elaborazione** | 5-30 minuti | 1 secondo - 2 minuti |
| **Qualita** | Eccellente (replica esatta dell'oggetto) | Buona-Ottima (approssimazione) |
| **Limitazione** | Solo oggetti fisici reali | Qualsiasi oggetto, anche immaginario |
| **Hardware richiesto** | macOS + Apple Silicon | GPU NVIDIA (self-hosted) o Cloud |
| **Costo** | Solo hardware locale | Hardware dedicato o pay-per-use |

---

## 3. Modelli Cloud API

I seguenti servizi offrono API cloud per la generazione 3D. Non richiedono hardware dedicato e sono i piu semplici da integrare.

### 3.1 Tripo AI

- **Input supportati:** testo, singola immagine, immagini multiple
- **Modelli disponibili:** v1.4, v2.0, v2.5, v3.0
- **Prezzo indicativo:** ~$0.20-0.40 per modello generato
- **Formati di output:** GLB, FBX, OBJ
- **Punto di forza:** versatilita di input e topologia pulita delle mesh generate
- **Documentazione dettagliata:** [`01-tripo-ai.md`](./01-tripo-ai.md)

### 3.2 Meshy AI

- **Input supportati:** testo, singola immagine, immagini multiple
- **Velocita:** il piu veloce tra i servizi cloud (30-60 secondi)
- **Prezzo indicativo:** sistema a crediti (5-30 crediti per operazione)
- **Formati di output:** GLB, OBJ, FBX, STL
- **Punto di forza:** velocita di generazione e semplicita delle API
- **Documentazione dettagliata:** [`02-meshy-ai.md`](./02-meshy-ai.md)

### 3.3 Rodin (Hyper3D)

- **Input supportati:** testo, singola immagine, multi-view
- **Qualita:** la piu alta tra tutti i modelli analizzati (8.5-9.5 su 10)
- **Prezzo indicativo:** fascia premium (non specificato pubblicamente)
- **Formati di output:** GLB, OBJ, FBX
- **Punto di forza:** qualita leader nel settore, texture PBR fino a 4K di risoluzione
- **Documentazione dettagliata:** [`03-rodin-hyper3d.md`](./03-rodin-hyper3d.md)

---

## 4. Modelli Open Source / Self-Hosted

I seguenti modelli possono essere eseguiti localmente su hardware proprio. Eliminano i costi ricorrenti ma richiedono GPU NVIDIA dedicate.

### 4.1 TripoSR

- **Input supportati:** singola immagine
- **Velocita:** velocissimo, meno di 1 secondo per modello
- **Licenza:** MIT
- **Hardware richiesto:** GPU NVIDIA con almeno 12 GB di VRAM
- **Formati di output:** OBJ (nativo)
- **Punto di forza:** velocita estrema e zero costi ricorrenti
- **Documentazione dettagliata:** [`04-triposr.md`](./04-triposr.md)

### 4.2 SPAR3D

- **Input supportati:** singola immagine (con possibilita di editing della point cloud)
- **Velocita:** veloce, meno di 1 secondo
- **Caratteristiche:** UV-unwrapping automatico, delighting integrato
- **Hardware richiesto:** GPU NVIDIA con almeno 8 GB di VRAM
- **Formati di output:** GLB, OBJ
- **Punto di forza:** qualita dell'output, UV-unwrap automatico e possibilita di editing interattivo
- **Documentazione dettagliata:** [`05-spar3d.md`](./05-spar3d.md)

### 4.3 Shap-E (OpenAI)

- **Input supportati:** testo e immagine (unico modello open source a supportare entrambi)
- **Velocita:** piu lento rispetto agli altri (nell'ordine dei minuti)
- **Qualita:** base, adatto a prototipi rapidi
- **Hardware richiesto:** GPU NVIDIA
- **Formati di output:** PLY, STL
- **Punto di forza:** unico modello open source con supporto text-to-3D gratuito
- **Documentazione dettagliata:** [`06-shap-e.md`](./06-shap-e.md)

### 4.4 InstantMesh

- **Input supportati:** singola immagine
- **Approccio:** generazione multi-view con ricostruzione geometrica
- **Hardware richiesto:** GPU NVIDIA con almeno 24 GB di VRAM
- **Formati di output:** OBJ, GLB
- **Punto di forza:** geometria particolarmente accurata grazie all'approccio multi-view
- **Documentazione dettagliata:** [`07-instantmesh.md`](./07-instantmesh.md)

### 4.5 Hunyuan3D (Tencent)

- **Input supportati:** testo e immagine (tra i pochi open source con entrambi)
- **Versioni:** 2.0, 2.1 (PBR production-ready), 2.5 (performance +72%)
- **Licenza:** Apache-2.0 (restrizioni in EU/UK/Corea del Sud)
- **Hardware richiesto:** GPU con 16 GB VRAM (v2.0) o 29 GB (v2.1 completa)
- **Formati di output:** GLB (con PBR), OBJ + MTL
- **Punto di forza:** unico open source con texture PBR native (Albedo, Normal, Roughness, Metallic), supporta macOS
- **Documentazione dettagliata:** [`10-hunyuan3d.md`](./10-hunyuan3d.md)

---

## 5. ComfyUI come Orchestratore Pipeline

In alternativa all'integrazione diretta di ogni modello, **ComfyUI** puo essere utilizzato come backend unificato per orchestrare i modelli self-hosted. ComfyUI offre:

- **Interfaccia visuale a nodi** per progettare workflow 3D
- **REST API integrata** (porta 8188) per submit, polling e download
- **Nodi nativi** per TripoSR, Tripo v3.0 API, Rodin Gen-2, Hunyuan3D
- **Modalita headless/server** per utilizzo in pipeline automatizzate

Questo approccio riduce la complessita di integrazione: invece di gestire N setup diversi, si ha un unico server ComfyUI con nodi per ogni modello.

- **Documentazione dettagliata:** [`11-comfyui-pipeline.md`](./11-comfyui-pipeline.md)

---

## 6. Matrice Comparativa Completa

La tabella seguente riassume tutti i modelli analizzati, inclusa la fotogrammetria attualmente in uso, per un confronto diretto.

| | Fotogramm. | Tripo AI | Meshy AI | Rodin | TripoSR | SPAR3D | Shap-E | InstantMesh | Hunyuan3D |
|---|---|---|---|---|---|---|---|---|---|
| **Tipo** | Locale | Cloud | Cloud | Cloud | Self-hosted | Self-hosted | Self-hosted | Self-hosted | Self-hosted |
| **Text-to-3D** | No | Si | Si | Si | No | No | Si | No | Si |
| **Image-to-3D** | Si (multi) | Si | Si | Si | Si | Si | Si | Si | Si |
| **PBR nativo** | No | No | No | Si (4K) | No | No | No | No | Si |
| **Velocita** | 5-30 min | 10-90 s | 30-60 s | 20-90 s | < 1 s | < 1 s | Minuti | 60-120 s | 8-20 s |
| **Qualita** | Eccellente | Ottima | Buona | Eccellente | Buona | Molto Buona | Base | Ottima | Eccellente |
| **Costo/modello** | Gratuito | $0.20-0.40 | 5-30 crediti | Premium | Gratuito | Gratuito | Gratuito | Gratuito | Gratuito |
| **Output OBJ** | Si | Si | Si | Si | Si | Si | Via conv. | Si | Si |
| **Output USDZ** | Si | Via conv. | Via conv. | Via conv. | Via conv. | Via conv. | Via conv. | Via conv. | Via conv. |
| **Hardware** | macOS ARM | Nessuno | Nessuno | Nessuno | NVIDIA 12GB | NVIDIA 8GB | NVIDIA | NVIDIA 24GB | 16-29GB |
| **macOS** | Si | N/A | N/A | N/A | No | No | No | No | Si |
| **Licenza** | Proprietaria | Proprietaria | Proprietaria | Proprietaria | MIT | Custom | MIT | Apache-2.0 | Apache-2.0* |

\* Hunyuan3D: Apache-2.0 con restrizioni in EU/UK/Corea del Sud

---

## 7. Guida alla Scelta

A seconda delle priorita del progetto, i modelli consigliati sono i seguenti:

1. **Per qualita massima:** Rodin (cloud) oppure Fotogrammetria (locale)
2. **Per velocita massima:** TripoSR o SPAR3D (self-hosted, meno di 1 secondo)
3. **Per text-to-3D cloud:** Tripo AI o Meshy AI
4. **Per text-to-3D self-hosted:** Hunyuan3D (qualita eccellente) o Shap-E (piu leggero)
5. **Per il miglior rapporto qualita/prezzo cloud:** Meshy AI
6. **Per PBR production-ready self-hosted:** Hunyuan3D 2.1 (unico con texture PBR native)
7. **Per geometria accurata self-hosted:** InstantMesh
8. **Per zero costi ricorrenti:** qualsiasi modello self-hosted
9. **Per semplicita di setup:** qualsiasi Cloud API
10. **Per orchestrazione unificata self-hosted:** ComfyUI come backend

---

## 8. Struttura della Documentazione

Di seguito l'elenco completo dei documenti di questa sezione:

| Documento | Descrizione |
|---|---|
| [`00-overview.md`](./00-overview.md) | Questo documento - panoramica e matrice comparativa |
| [`01-tripo-ai.md`](./01-tripo-ai.md) | Tripo AI (Cloud) |
| [`02-meshy-ai.md`](./02-meshy-ai.md) | Meshy AI (Cloud) |
| [`03-rodin-hyper3d.md`](./03-rodin-hyper3d.md) | Rodin / Hyper3D (Cloud) |
| [`04-triposr.md`](./04-triposr.md) | TripoSR (Self-Hosted) |
| [`05-spar3d.md`](./05-spar3d.md) | SPAR3D (Self-Hosted) |
| [`06-shap-e.md`](./06-shap-e.md) | Shap-E (Self-Hosted) |
| [`07-instantmesh.md`](./07-instantmesh.md) | InstantMesh (Self-Hosted) |
| [`08-format-conversion.md`](./08-format-conversion.md) | Guida alla Conversione dei Formati |
| [`09-architecture.md`](./09-architecture.md) | Architettura di Integrazione |
| [`10-hunyuan3d.md`](./10-hunyuan3d.md) | Hunyuan3D (Self-Hosted, PBR) |
| [`11-comfyui-pipeline.md`](./11-comfyui-pipeline.md) | ComfyUI come Orchestratore Pipeline |

---

## 9. Prossimi Passi

1. **Scegliere 1-2 provider iniziali** per un proof-of-concept (consigliati: Hunyuan3D per self-hosted, Meshy o Tripo per cloud)
2. **Decidere l'approccio di orchestrazione**: integrazione diretta (AIProcessManager) o ComfyUI come backend unificato (vedi [`11-comfyui-pipeline.md`](./11-comfyui-pipeline.md))
3. **Implementare AIProcessManager** o **ComfyUIProcessManager** (vedi [`09-architecture.md`](./09-architecture.md))
4. **Implementare la pipeline di conversione formati** per garantire compatibilita tra i diversi output (vedi [`08-format-conversion.md`](./08-format-conversion.md))
5. **Estendere lo schema del database** e i messaggi della coda AMQP per supportare i nuovi tipi di elaborazione
6. **Testing con campioni reali** per validare qualita e tempi di elaborazione in scenari concreti
