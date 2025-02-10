const fs = require("fs");
const { exec } = require("child_process");
const path = require("path");
const dotenv = require("dotenv");
const { uploadDir, downloadFiles, downloadFromTelegram } = require("./utils/s3");
const { getProject, getTelegramUser, updateProject } = require("./utils/db");
const { sendMessage, sendDocument } = require("./utils/telegram");
// const bot = require("../lib/telegram");

dotenv.config();

// const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;

const libDir = path.join(__dirname, "..", "src", "lib");

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
    this.imgDir = `projects/${id}/images`;
    this.outDir = `projects/${id}/model/`;
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

    // const { error } = await supabase
    //   .from("project")
    //   .update(updateObj)
    //   .eq("id", parseInt(this.id));
    try {
      updateProject(parseInt(this.id), updateObj)
    } catch (error) {
      console.error(`Error updating project for ID: ${this.id}:`, error);
      throw error;
    }
  }

  /**
   * Scarica i file del progetto da Telegram o dal storage
   * @throws {Error} Se non ci sono file da processare
   */
  async downloadProjectFiles() {
    const { files } = this.project;
    if (!files || files.length === 0) throw new Error("No files to process");
    
    if (this.isTelegram) {
      await downloadFromTelegram(this.imgDir, files);
    } else {
      try {
        await downloadFiles(`${this.id}`, files);
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
   * @throws {Error} Se la generazione del modello fallisce
   */
  async processModel() {
    const _outDir = path.join(__dirname, "..", this.outDir);
    const _imgDir = path.join(__dirname, "..", this.imgDir);
    
    // Impostiamo un valore predefinito per ordering se è undefined
    const ordering = this.project.ordering || 'unordered';
    
    const command = `cd ${libDir} && ./HelloPhotogrammetry ${_imgDir} ${_outDir}model.usdz -d ${this.project.detail} -o ${ordering} -f ${this.project.feature}`;
    
    await new Promise((res, rej) =>
      exec(command, (error) => {
        if (error) {
          rej(error);
          return;
        }
        fs.promises
          .access(`${_outDir}model.usdz`)
          .then(() => res("ok"))
          .catch(() => rej("File not found"));
      })
    );
  }

  /**
   * Converte il modello USDZ in altri formati
   * @returns {Promise<string>} 'ok' se la conversione ha successo
   */
  async convertModel() {
    const _modelDir = path.join(__dirname, "..", this.outDir);
    return new Promise((res, rej) =>
      exec(`cd ${libDir} && ./usdconv ${_modelDir}model.usdz`, (error) => {
        if (error) {
          console.log(error);
          res(error);
          return;
        }
        res("ok");
      })
    );
  }

  /**
   * Invia notifiche all'utente Telegram con il link al modello
   * @throws {Error} Se c'è un errore nel recupero dei dati utente
   */
  async notifyTelegram() {
    if (!this.isTelegram) return;

    // const { data, error } = await supabase
    //   .from("telegram_user")
    //   .select("user_id")
    //   .eq("id", this.project.telegram_user)
    //   .single();
    const data = await getTelegramUser(this.project.telegram_user)
    
    if (error) throw error;

    // bot.telegram.sendMessage(
    //   data.user_id,
    //   `Processing done for process ${this.id}`
    // );
    sendMessage(data.user_id, `Processing done for process ${this.id}`)
    // bot.telegram.sendMessage(
    //   data.user_id,
    //   `You can download the model from this link: ${SUPABASE_URL}/viewer/${this.id}`
    // );
    sendMessage(data.user_id, `You can download the model from this link: ${SUPABASE_URL}/viewer/${this.id}`)

    
    const source = path.join(__dirname, "..", this.id, "model.usdz");
    // await bot.telegram.sendDocument(data.user_id, { source: source });
    await sendDocument(data.user_id, source)
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
    try {
      console.log(`Starting process for ID: ${this.id}`);
      
      // Update status to processing
      await this.updateStatus('processing');

      // Download files
      await this.downloadProjectFiles();

      // Create model folder
      await fs.promises.mkdir(this.outDir, { recursive: true });

      // Process the model
      await this.processModel();

      // Delete images
      await this.cleanupImages();

      // Convert model
      await this.convertModel();

      // Upload to S3
      const model_urls = await this.uploadToS3();

      // Notify Telegram if needed
      this.isTelegram && await this.notifyTelegram();

      // Update status to done
      await this.updateStatus('done', { model_urls });

      console.log(`Processing ${this.id} done`);

    } catch (error) {
      console.error(`Error processing ${this.id}:`, error);
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
    // const { data: project, error } = await supabase
    //   .from("project")
    //   .select("*")
    //   .eq("id", id)
    //   .single();
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