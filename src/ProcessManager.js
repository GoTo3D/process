const fs = require('fs');
const { statfs } = require('fs/promises');
const { spawn } = require('child_process');
const path = require('path');
const config = require('./config');
const { uploadDir, downloadFiles, downloadFromTelegram, cleanupRemoteFiles } = require('./utils/s3');
const { getProject, getTelegramUser, updateProject } = require('./utils/db');
const { sendMessage, sendDocument } = require('./utils/telegram');

// Whitelist per parametri PhotoProcess (previene Command Injection)
const ALLOWED_DETAILS = ['preview', 'reduced', 'medium', 'full', 'raw', 'custom'];
const ALLOWED_ORDERINGS = ['unordered', 'sequential'];
const ALLOWED_FEATURES = ['normal', 'high'];

/**
 * Valida e sanitizza un parametro contro una whitelist
 * @param {string} value
 * @param {string[]} allowedValues
 * @param {string} defaultValue
 * @returns {string}
 */
const sanitizeParam = (value, allowedValues, defaultValue) => {
  if (typeof value !== 'string') return defaultValue;
  const normalized = value.toLowerCase().trim();
  return allowedValues.includes(normalized) ? normalized : defaultValue;
};

const libDir = path.join(__dirname, 'lib');

// Timeout per il processo di fotogrammetria
const PHOTOGRAMMETRY_TIMEOUT = 30 * 60 * 1000; // 30 minuti

class ProcessManager {
  /**
   * @param {string|number} id
   * @param {Object} project
   */
  constructor(id, project) {
    this.id = id;
    this.project = project;
    this.imgDir = path.join(config.PROJECTS_BASE_DIR, `${id}`, 'images');
    this.outDir = path.join(config.PROJECTS_BASE_DIR, `${id}`, 'model');
    this.isTelegram = !!project.telegram_user;
    this._remoteLocations = [];
    this._modelDimensions = null;
  }

  /**
   * Aggiorna lo stato del progetto nel database
   * @param {string} status
   * @param {Object} additionalData
   */
  async updateStatus(status, additionalData = {}) {
    const updateObj = {
      status,
      ...(status === 'processing' && { process_start: new Date() }),
      ...(['done', 'error'].includes(status) && { process_end: new Date() }),
      ...additionalData
    };

    try {
      await updateProject(parseInt(this.id), updateObj);
    } catch (error) {
      console.error(`Error updating project for ID: ${this.id}:`, error);
      throw error;
    }
  }

  /**
   * Controlla lo spazio disco disponibile
   * @param {number} requiredMB
   */
  async checkDiskSpace(requiredMB = 500) {
    try {
      const stats = await statfs(config.PROJECTS_BASE_DIR);
      const availableMB = (stats.bavail * stats.bsize) / (1024 * 1024);
      if (availableMB < requiredMB) {
        throw new Error(
          `Insufficient disk space: ${Math.round(availableMB)}MB available, ${requiredMB}MB required`
        );
      }
      console.log(`Disk space OK: ${Math.round(availableMB)}MB available`);
    } catch (err) {
      if (err.code === 'ENOENT') {
        console.warn(`Base directory ${config.PROJECTS_BASE_DIR} not found, skipping disk check`);
        return;
      }
      throw err;
    }
  }

  /**
   * Scarica i file del progetto da Telegram o dallo storage.
   * Non cancella i file remoti (cancellazione differita).
   */
  async downloadProjectFiles() {
    const { files } = this.project;
    if (!files || files.length === 0) throw new Error('No files to process');

    // Verifica se i file esistono gia' localmente
    try {
      const localFiles = await fs.promises.readdir(this.imgDir);
      if (localFiles.length > 0) {
        console.log(`Found ${localFiles.length} local files, skipping download`);
        return;
      }
    } catch {
      // Directory non esiste ancora, procedi con il download
    }

    if (this.isTelegram) {
      await downloadFromTelegram(this.imgDir, files);
      this._remoteLocations = [];
    } else {
      try {
        const locations = await downloadFiles(`${this.id}`, files, this.imgDir);
        this._remoteLocations = locations;
      } catch (error) {
        console.error(`Error downloading files for project ${this.id}:`, error);
        // Verifica se la cartella ha file parziali
        try {
          const imageFiles = await fs.promises.readdir(this.imgDir);
          if (imageFiles.length === 0) {
            throw new Error('No images downloaded successfully');
          }
          console.warn(`Partial download completed with ${imageFiles.length} files`);
        } catch (e) {
          if (e.code === 'ENOENT') {
            throw new Error(`Download failed completely: ${error.message}`);
          }
          throw e;
        }
      }
    }
  }

  /**
   * Esegue la generazione del modello 3D e la conversione in OBJ usando PhotoProcess
   * @returns {Promise<string>}
   */
  async processAndConvert() {
    const detail = sanitizeParam(this.project.detail, ALLOWED_DETAILS, 'medium');
    const ordering = sanitizeParam(this.project.order, ALLOWED_ORDERINGS, 'unordered');
    const feature = sanitizeParam(this.project.feature, ALLOWED_FEATURES, 'normal');

    const bin = path.join(libDir, 'PhotoProcess');
    const args = [
      this.imgDir,
      this.outDir,
      '--detail', detail,
      '--ordering', ordering,
      '--feature-sensitivity', feature
    ];

    // CR-16: Pass custom detail parameters if present
    if (detail === 'custom') {
      const { max_polygons, texture_dimension, texture_format, texture_quality, texture_maps } = this.project;
      if (max_polygons) args.push('--max-polygons', String(max_polygons));
      if (texture_dimension) args.push('--texture-dimension', String(texture_dimension));
      if (texture_format) args.push('--texture-format', String(texture_format));
      if (texture_quality != null) args.push('--texture-quality', String(texture_quality));
      if (texture_maps) args.push('--texture-maps', String(texture_maps));
    }

    console.log(`Executing: ${bin} ${args.join(' ')}`);

    return new Promise((resolve, reject) => {
      let settled = false;
      const settle = (fn, value) => {
        if (!settled) {
          settled = true;
          fn(value);
        }
      };

      const child = spawn(bin, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      child.stdout.on('data', (data) => {
        const lines = data.toString().trim().split('\n');
        for (const line of lines) {
          try {
            const event = JSON.parse(line);
            switch (event.type) {
              case 'progress': {
                const pct = (event.fraction * 100).toFixed(1);
                const stage = event.stage || '';
                const eta = event.eta_seconds
                  ? ` (ETA: ${Math.round(event.eta_seconds)}s)`
                  : '';
                console.log(`[photoprocess:${event.request}] ${pct}% ${stage}${eta}`);
                break;
              }
              case 'complete':
                console.log(`[photoprocess] ${event.request} complete: ${event.output_path}`);
                break;
              case 'error':
                console.error(`[photoprocess:error] ${event.request}: ${event.message}`);
                break;
              case 'invalid_sample':
                console.warn(`[photoprocess] Invalid sample #${event.sample_id}: ${event.reason}`);
                break;
              case 'skipped_sample':
                console.warn(`[photoprocess] Skipped sample #${event.sample_id}`);
                break;
              case 'model_info':
                this._modelDimensions = {
                  dimensions: event.dimensions,
                  bounding_box: event.bounding_box,
                  unit: event.unit,
                };
                console.log(`[photoprocess] Model dimensions: ${event.dimensions.width}x${event.dimensions.height}x${event.dimensions.depth} ${event.unit}`);
                break;
              default:
                console.log(`[photoprocess] ${event.type}`);
            }
          } catch {
            console.log(`[photoprocess] ${line}`);
          }
        }
      });

      child.stderr.on('data', (data) => {
        console.error(`[photoprocess:err] ${data.toString().trim()}`);
      });

      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        settle(reject, new Error(`Process killed due to timeout (${PHOTOGRAMMETRY_TIMEOUT}ms)`));
      }, PHOTOGRAMMETRY_TIMEOUT);

      child.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          settle(reject, new Error(`PhotoProcess exited with code ${code}`));
          return;
        }
        const outputPath = path.join(this.outDir, 'model.usdz');
        fs.promises
          .access(outputPath)
          .then(() => settle(resolve, 'ok'))
          .catch(() => settle(reject, new Error('Output file not found')));
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        settle(reject, err);
      });
    });
  }

  /**
   * Invia notifiche all'utente Telegram
   */
  async notifyTelegram() {
    if (!this.isTelegram) return;

    const data = await getTelegramUser(this.project.telegram_user);

    await sendMessage(data.user_id, `Processing done for process ${this.id}`);
    await sendMessage(data.user_id, `You can download the model from this link: ${config.SUPABASE_URL}/viewer/${this.id}`);

    const source = path.join(this.outDir, 'model.usdz');
    await sendDocument(data.user_id, source);
  }

  /**
   * Carica i file del modello su S3
   * @returns {Promise<string[]>}
   */
  async uploadToS3() {
    return uploadDir({
      file_location: this.outDir,
      bucket_location: `${this.id}`,
    });
  }

  /**
   * Cleanup completo di tutte le directory locali del progetto
   */
  async cleanupAll() {
    const dirs = [this.imgDir, this.outDir];
    for (const dir of dirs) {
      try {
        await fs.promises.rm(dir, { recursive: true, force: true });
        console.log(`Cleaned up: ${dir}`);
      } catch (e) {
        console.warn(`Failed to cleanup ${dir}:`, e.message);
      }
    }
  }

  /**
   * Esegue l'intero processo di elaborazione
   */
  async process() {
    const startTime = Date.now();
    try {
      console.log(`Starting process for ID: ${this.id}`);

      // Check disk space
      await this.checkDiskSpace();

      // Update status to processing
      await this.updateStatus('processing');

      // Create directories
      await fs.promises.mkdir(this.imgDir, { recursive: true });
      await fs.promises.mkdir(this.outDir, { recursive: true });

      // Download files
      console.log(`Downloading files for ID: ${this.id}`);
      await this.downloadProjectFiles();
      console.log(`Files downloaded for ID: ${this.id}`);

      // Process the model (USDZ + OBJ in a single step)
      console.log(`Processing model for ID: ${this.id}`);
      await this.processAndConvert();
      console.log(`Model processed for ID: ${this.id}`);

      // Upload to S3
      console.log(`Uploading to S3 for ID: ${this.id}`);
      const model_urls = await this.uploadToS3();
      console.log(`Uploaded to S3 for ID: ${this.id}`);

      // Notify Telegram if needed
      if (this.isTelegram) {
        console.log(`Notifying Telegram for ID: ${this.id}`);
        await this.notifyTelegram();
        console.log(`Notified Telegram for ID: ${this.id}`);
      }

      // Update status to done
      const doneData = { model_urls };
      if (this._modelDimensions) doneData.model_dimensions = this._modelDimensions;
      await this.updateStatus('done', doneData);

      // Cleanup dei file remoti solo dopo successo completo
      if (this._remoteLocations.length > 0) {
        await cleanupRemoteFiles(this._remoteLocations);
      }

      // Cleanup locale
      await this.cleanupAll();

      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`Processing ${this.id} done in ${duration}s`);
    } catch (error) {
      console.error(`Error processing ${this.id}:`, error);
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`Processing ${this.id} failed after ${duration}s`);

      await this.updateStatus('error').catch(e =>
        console.error(`Failed to update error status for ${this.id}:`, e)
      );

      // Cleanup locale anche in caso di errore
      await this.cleanupAll();

      throw error;
    }
  }

  /**
   * Factory method
   * @param {string|number} id
   * @returns {Promise<ProcessManager>}
   */
  static async create(id) {
    const project = await getProject(id);
    return new ProcessManager(id, project);
  }
}

module.exports = ProcessManager;
