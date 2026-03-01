const fs = require("fs");
const { exec } = require("child_process");
const path = require("path");
const dotenv = require("dotenv");
const { uploadDir, downloadFiles, downloadFromTelegram } = require("./utils/s3");
const { getProject, getTelegramUser, updateProject } = require("./utils/db");
const { sendMessage, sendDocument } = require("./utils/telegram");

dotenv.config();

const time = (who) => {
  return {
    start: () => {
      console.time(`[${who}]`);
    },
    end: () => {
      console.timeEnd(`[${who}]`);
    }
  }
}

// Whitelist per parametri HelloPhotogrammetry (previene Command Injection)
const ALLOWED_DETAILS = ['preview', 'reduced', 'medium', 'full', 'raw'];
const ALLOWED_ORDERINGS = ['unordered', 'sequential'];
const ALLOWED_FEATURES = ['normal', 'high'];

/**
 * Valida e sanitizza un parametro contro una whitelist
 * @param {string} value - Valore da validare
 * @param {string[]} allowedValues - Valori permessi
 * @param {string} defaultValue - Valore di default se non valido
 * @returns {string} Valore validato
 */
const sanitizeParam = (value, allowedValues, defaultValue) => {
  if (typeof value !== 'string') return defaultValue;
  const normalized = value.toLowerCase().trim();
  return allowedValues.includes(normalized) ? normalized : defaultValue;
};

const SUPABASE_URL = process.env.SUPABASE_URL;

const libDir = path.join(__dirname, "..", "src", "lib");

// Timeout per i comandi exec (30 minuti per photogrammetry, 5 minuti per conversione)
const PHOTOGRAMMETRY_TIMEOUT = 30 * 60 * 1000;
const CONVERSION_TIMEOUT = 5 * 60 * 1000;

/**
 * Gestisce il processo di elaborazione di un progetto 3D
 * Include il download dei file, la generazione del modello e l'upload su S3
 */
class ProcessManager {
  /**
   * @param {string|number} id - ID del progetto
   * @param {Object} project - Dati del progetto dal database
   */
  constructor(id, project) {
    this.id = id;
    this.project = project;
    this.imgDir = `/Volumes/T7/projects/${id}/images/`;
    this.outDir = `/Volumes/T7/projects/${id}/model/`;
    this.isTelegram = !!project.telegram_user;
  }

  /**
   * Aggiorna lo stato del progetto nel database
   * @param {string} status - Nuovo stato ('processing', 'done', 'error')
   * @param {Object} additionalData - Dati aggiuntivi da salvare
   */
  async updateStatus(status, additionalData = {}) {
    const updateObj = {
      status,
      ...(status === 'processing' && { process_start: new Date() }),
      ...((['done', 'error'].includes(status)) && { process_end: new Date() }),
      ...additionalData
    };

    try {
      await updateProject(parseInt(this.id), updateObj)
    } catch (error) {
      console.error(`Error updating project for ID: ${this.id}:`, error);
      throw error;
    }
  }

  /**
   * Scarica i file del progetto da Telegram o dal storage
   * Se i file esistono già localmente, salta il download
   * @throws {Error} Se non ci sono file da processare
   */
  async downloadProjectFiles() {
    const { files } = this.project;
    if (!files || files.length === 0) throw new Error("No files to process");

    // Verifica se i file esistono già localmente (utile per test con --local)
    try {
      const localFiles = await fs.promises.readdir(this.imgDir);
      if (localFiles.length > 0) {
        console.log(`Found ${localFiles.length} local files, skipping download`);
        return;
      }
    } catch (e) {
      // Directory non esiste ancora, procedi con il download
    }

    if (this.isTelegram) {
      await downloadFromTelegram(this.imgDir, files);
    } else {
      try {
        await downloadFiles(`${this.id}`, files, this.imgDir);
      } catch (error) {
        console.error(`Errore durante il download dei file per il progetto ${this.id}:`, error);
        // Verifica se la cartella delle immagini esiste e contiene file
        try {
          const imageFiles = await fs.promises.readdir(this.imgDir);
          if (imageFiles.length === 0) {
            throw new Error('Nessuna immagine scaricata correttamente');
          }
          console.warn(`Download parzialmente completato con ${imageFiles.length} file`);
        } catch (e) {
          throw new Error(`Download fallito completamente: ${error.message}`);
        }
      }
    }
  }

  /**
   * Esegue la generazione del modello 3D usando HelloPhotogrammetry
   * @returns {Promise<string>} 'ok' se la generazione è avvenuta con successo
   * @throws {Error} Se la generazione del modello fallisce
   */
  async processModel() {
    const _outDir = this.outDir;
    const _imgDir = this.imgDir;

    // Sanitizza i parametri per prevenire Command Injection
    // Nota: la colonna nel DB si chiama 'order', non 'ordering'
    const detail = sanitizeParam(this.project.detail, ALLOWED_DETAILS, 'medium');
    const ordering = sanitizeParam(this.project.order, ALLOWED_ORDERINGS, 'unordered');
    const feature = sanitizeParam(this.project.feature, ALLOWED_FEATURES, 'normal');

    const command = `cd ${libDir} && ./HelloPhotogrammetry ${_imgDir} ${_outDir}model.usdz -d ${detail} -o ${ordering} -f ${feature}`;

    console.log(`Executing command: ${command}`);

    return new Promise((res, rej) => {
      const childProcess = exec(command, { timeout: PHOTOGRAMMETRY_TIMEOUT }, (error, stdout, stderr) => {
        console.log(`stdout: ${stdout}`);
        if (error) {
          console.error(`stderr: ${stderr}`);
          if (error.killed) {
            rej(new Error(`Process killed due to timeout (${PHOTOGRAMMETRY_TIMEOUT}ms)`));
          } else {
            rej(error);
          }
          return;
        }
        fs.promises
          .access(`${_outDir}model.usdz`)
          .then(() => res("ok"))
          .catch(() => rej(new Error("Output file not found")));
      });

      childProcess.on('error', (err) => rej(err));
    });
  }

  /**
   * Converte il modello USDZ in altri formati
   * @returns {Promise<string>} 'ok' se la conversione ha successo
   */
  async convertModel() {
    const _modelDir = this.outDir;
    const command = `cd ${libDir} && ./usdconv ${_modelDir}model.usdz`;

    return new Promise((res, rej) => {
      const childProcess = exec(command, { timeout: CONVERSION_TIMEOUT }, (error) => {
        if (error) {
          if (error.killed) {
            rej(new Error(`Conversion killed due to timeout (${CONVERSION_TIMEOUT}ms)`));
          } else {
            rej(error);
          }
          return;
        }
        res("ok");
      });

      childProcess.on('error', (err) => rej(err));
    });
  }

  /**
   * Invia notifiche all'utente Telegram con il link al modello
   * @throws {Error} Se c'è un errore nel recupero dei dati utente
   */
  async notifyTelegram() {
    if (!this.isTelegram) return;

    const data = await getTelegramUser(this.project.telegram_user);

    sendMessage(data.user_id, `Processing done for process ${this.id}`);

    sendMessage(data.user_id, `You can download the model from this link: ${SUPABASE_URL}/viewer/${this.id}`);

    const source = path.join(this.outDir, "model.usdz");
    await sendDocument(data.user_id, source);
  }

  /**
   * Carica i file del modello su S3
   * @returns {Promise<Object>} URLs dei file caricati
   */
  async uploadToS3() {
    return await uploadDir({
      file_location: this.outDir,
      bucket_location: `${this.id}`,
    });
  }

  /**
   * Elimina le immagini originali dopo la generazione del modello
   */
  async cleanupImages() {
    await fs.promises.rm(this.imgDir, { recursive: true });
  }

  /**
   * Esegue l'intero processo di elaborazione
   * 1. Download dei file
   * 2. Generazione del modello
   * 3. Conversione
   * 4. Upload su S3
   * 5. Notifiche
   * @throws {Error} Se qualsiasi fase del processo fallisce
   */
  async process() {
    let timeIdentify;
    try {
      time(this.id).start();
      console.log(`Starting process for ID: ${this.id}`);
      // Update status to processing
      console.log(`Updating status to processing for ID: ${this.id}`);
      timeIdentify = `${this.id}_updateStatus`
      time(timeIdentify).start();
      await this.updateStatus('processing');
      time(timeIdentify).end();
      console.log(`Status updated to processing for ID: ${this.id}`);

      // Create images folder
      console.log(`Creating images folder for ID: ${this.id}`);
      timeIdentify = `${this.id}_createImagesFolder`
      time(timeIdentify).start();
      await fs.promises.mkdir(this.imgDir, { recursive: true });
      time(timeIdentify).end();
      console.log(`Images folder created for ID: ${this.id}`);

      // Download files
      console.log(`Downloading files for ID: ${this.id}`);
      timeIdentify = `${this.id}_downloadFiles`
      time(timeIdentify).start();
      await this.downloadProjectFiles();
      time(timeIdentify).end();
      console.log(`Files downloaded for ID: ${this.id}`);

      // Create model folder
      console.log(`Creating model folder for ID: ${this.id}`);
      timeIdentify = `${this.id}_createModelFolder`
      time(timeIdentify).start();
      await fs.promises.mkdir(this.outDir, { recursive: true });
      time(timeIdentify).end();
      console.log(`Model folder created for ID: ${this.id}`);

      // Process the model
      console.log(`Processing model for ID: ${this.id}`);
      timeIdentify = `${this.id}_processModel`
      time(timeIdentify).start();
      await this.processModel();
      time(timeIdentify).end();
      console.log(`Model processed for ID: ${this.id}`);

      // Delete images
      console.log(`Cleaning up images for ID: ${this.id}`);
      timeIdentify = `${this.id}_cleanupImages`
      time(timeIdentify).start();
      await this.cleanupImages();
      time(timeIdentify).end();
      console.log(`Images cleaned up for ID: ${this.id}`);

      // Convert model
      console.log(`Converting model for ID: ${this.id}`);
      timeIdentify = `${this.id}_convertModel`
      time(timeIdentify).start();
      await this.convertModel();
      time(timeIdentify).end();
      console.log(`Model converted for ID: ${this.id}`);

      // Upload to S3
      console.log(`Uploading to S3 for ID: ${this.id}`);
      timeIdentify = `${this.id}_uploadToS3`
      time(timeIdentify).start();
      const model_urls = await this.uploadToS3();
      time(timeIdentify).end();
      console.log(`Uploaded to S3 for ID: ${this.id}`);

      // Notify Telegram if needed
      if (this.isTelegram) {
        console.log(`Notifying Telegram for ID: ${this.id}`);
        timeIdentify = `${this.id}_notifyTelegram`
        time(timeIdentify).start();
        await this.notifyTelegram();
        time(timeIdentify).end();
        console.log(`Notified Telegram for ID: ${this.id}`);
      }

      // Update status to done
      console.log(`Updating status to done for ID: ${this.id}`);
      timeIdentify = `${this.id}_updateStatus`
      time(timeIdentify).start();
      await this.updateStatus('done', { model_urls });
      time(timeIdentify).end();
      timeIdentify = null;
      console.log(`Status updated to done for ID: ${this.id}`);

      console.log(`Processing ${this.id} done`);
      time(this.id).end();
    } catch (error) {
      console.error(`Error processing ${this.id}:`, error);
      // cancello il console time generale (id) se si scatena un'eccezione
      time(this.id).end()
      // cancello il console time di uno specifico processo che ha scatenato l'eccezione
      if (timeIdentify) time(timeIdentify).end()
      await this.updateStatus('error');
      throw error;
    }
  }

  /**
   * Factory method per creare una nuova istanza di ProcessManager
   * @param {string|number} id - ID del progetto
   * @returns {Promise<ProcessManager>} Nuova istanza di ProcessManager
   * @throws {Error} Se il progetto non viene trovato
   */
  static async create(id) {
    try {
      const project = await getProject(id)
      return new ProcessManager(id, project);
    } catch (error) {
      console.error(`Error creating ProcessManager for ID: ${id}:`, error);
      throw error;
    }
  }
}

module.exports = ProcessManager;