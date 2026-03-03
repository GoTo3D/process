/**
 * Test utilities for e2e and unit tests
 */
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { supabase } = require('../../src/lib/supabaseClient');
const { supabaseAdmin } = require('./supabaseAdmin');
const { putObject, deleteObject, listObjects } = require('../../src/lib/s3Api');

dotenv.config();

const SAMPLE_IMAGES_PATH = '/Volumes/T7/sample';
const BUCKET = process.env.BUCKET;
console.log(`Using bucket: ${BUCKET}`);

/**
 * Ottiene il client Supabase appropriato (admin se disponibile, altrimenti normale)
 * @returns {Object} Client Supabase
 */
const getSupabaseClient = () => {
  if (supabaseAdmin) return supabaseAdmin;
  console.warn('Using anonymous client - some operations may fail due to RLS');
  return supabase;
};

/**
 * Crea un progetto di test nel database
 * Richiede SUPABASE_SERVICE_KEY per bypassare RLS
 * @param {Object} options - Opzioni per il progetto
 * @returns {Promise<Object>} Progetto creato
 */
const createTestProject = async (options = {}) => {
  const client = getSupabaseClient();

  if (!supabaseAdmin) {
    throw new Error(
      'SUPABASE_SERVICE_KEY required to create test projects.\n' +
      'Add it to your .env file (find it in Supabase Dashboard > Settings > API > service_role key)'
    );
  }

  const defaultOptions = {
    status: 'in queue', // Valori validi: 'in queue', 'processing', 'done', 'error'
    detail: 'preview', // Usa preview per test più veloci
    order: 'unordered', // Nota: la colonna nel DB si chiama 'order', non 'ordering'
    feature: 'normal',
    files: [],
    telegram_user: null,
    // user_id è obbligatorio - usa TEST_USER_ID da .env o un UUID di default
    user_id: process.env.TEST_USER_ID || 'd1d7fe7b-9b49-4803-afb5-276cb34eedfd',
  };

  const projectData = { ...defaultOptions, ...options };

  const { data, error } = await client
    .from('project')
    .insert(projectData)
    .select()
    .single();

  if (error) throw error;
  return data;
};

/**
 * Elimina un progetto di test dal database
 * Richiede SUPABASE_SERVICE_KEY per bypassare RLS
 * @param {number} id - ID del progetto
 */
const deleteTestProject = async (id) => {
  const client = getSupabaseClient();

  const { error } = await client
    .from('project')
    .delete()
    .eq('id', id);

  if (error) console.error('Error deleting test project:', error);
};

/**
 * Ottiene lo stato corrente di un progetto
 * @param {number} id - ID del progetto
 * @returns {Promise<Object>} Stato del progetto
 */
const getProjectStatus = async (id) => {
  const { data, error } = await supabase
    .from('project')
    .select('*')
    .eq('id', id)
    .single();

  if (error) throw error;
  return data;
};

/**
 * Carica le immagini di esempio su Cloudflare R2
 * @param {number} projectId - ID del progetto
 * @param {number} maxFiles - Numero massimo di file da caricare (default: 5)
 * @returns {Promise<string[]>} Array di nomi file caricati
 */
const uploadSampleImages = async (projectId, maxFiles = 5) => {
  const files = fs.readdirSync(SAMPLE_IMAGES_PATH)
    .filter(f => f.endsWith('.HEIC') || f.endsWith('.jpg') || f.endsWith('.png'))
    .slice(0, maxFiles);

  const uploadedFiles = [];

  for (const fileName of files) {
    const filePath = path.join(SAMPLE_IMAGES_PATH, fileName);
    const fileBuffer = fs.readFileSync(filePath);
    const storagePath = `${projectId}/images/${fileName}`;

    try {
      await putObject(BUCKET, storagePath, fileBuffer);
      uploadedFiles.push(fileName);
      console.log(`Uploaded: ${fileName}`);
    } catch (error) {
      console.error(`Error uploading ${fileName}:`, error);
    }
  }

  return uploadedFiles;
};

/**
 * Pulisce i file di storage per un progetto su Cloudflare R2
 * @param {number} projectId - ID del progetto
 */
const cleanupStorage = async (projectId) => {
  try {
    // Lista e cancella file immagini
    const imageKeys = await listObjects(BUCKET, `${projectId}/images/`);
    for (const key of imageKeys) {
      await deleteObject(BUCKET, key);
    }

    // Lista e cancella file modelli
    const modelKeys = await listObjects(BUCKET, `${projectId}/model/`);
    for (const key of modelKeys) {
      await deleteObject(BUCKET, key);
    }
  } catch (error) {
    console.error('Error cleaning up storage:', error);
  }
};

/**
 * Pulisce le directory locali di un progetto
 * @param {number} projectId - ID del progetto
 */
const cleanupLocalFiles = async (projectId) => {
  const projectDir = `/Volumes/T7/projects/${projectId}`;
  try {
    await fs.promises.rm(projectDir, { recursive: true, force: true });
    console.log(`Cleaned up local files for project ${projectId}`);
  } catch (error) {
    // Directory potrebbe non esistere
  }
};

/**
 * Attende che un progetto raggiunga uno stato specifico
 * @param {number} projectId - ID del progetto
 * @param {string} targetStatus - Stato target ('done', 'error', 'processing')
 * @param {number} timeout - Timeout in ms (default: 10 minuti)
 * @param {number} pollInterval - Intervallo di polling in ms (default: 5 secondi)
 * @returns {Promise<Object>} Stato finale del progetto
 */
const waitForStatus = async (projectId, targetStatus, timeout = 600000, pollInterval = 5000) => {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const project = await getProjectStatus(projectId);

    if (project.status === targetStatus) {
      return project;
    }

    if (project.status === 'error' && targetStatus !== 'error') {
      throw new Error(`Project ${projectId} failed with error status`);
    }

    console.log(`[${projectId}] Status: ${project.status}, waiting for: ${targetStatus}`);
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  throw new Error(`Timeout waiting for project ${projectId} to reach status: ${targetStatus}`);
};

/**
 * Invia un messaggio alla coda AMQP
 * @param {string} projectId - ID del progetto da processare
 */
const sendToQueue = async (projectId) => {
  const amqp = require('amqplib');

  const connection = await amqp.connect(process.env.QUEUE_CONNECTION_STRING);
  const channel = await connection.createChannel();

  const queue = process.env.QUEUE || 'processing-dev';
  await channel.assertQueue(queue, { durable: true });

  channel.sendToQueue(queue, Buffer.from(String(projectId)), {
    persistent: true
  });

  console.log(`Sent project ${projectId} to queue ${queue}`);

  await channel.close();
  await connection.close();
};

/**
 * Copia le immagini di esempio localmente (senza usare Supabase storage)
 * Utile per test di integrazione quando lo storage non è configurato
 * @param {number} projectId - ID del progetto
 * @param {number} maxFiles - Numero massimo di file da copiare (default: 5)
 * @returns {Promise<string[]>} Array di nomi file copiati
 */
const copyLocalSampleImages = async (projectId, maxFiles = 5) => {
  const imgDir = `/Volumes/T7/projects/${projectId}/images/`;

  // Crea la directory se non esiste
  await fs.promises.mkdir(imgDir, { recursive: true });

  const files = fs.readdirSync(SAMPLE_IMAGES_PATH)
    .filter(f => f.endsWith('.HEIC') || f.endsWith('.jpg') || f.endsWith('.png'))
    .slice(0, maxFiles);

  const copiedFiles = [];

  for (const fileName of files) {
    const srcPath = path.join(SAMPLE_IMAGES_PATH, fileName);
    const destPath = path.join(imgDir, fileName);

    try {
      await fs.promises.copyFile(srcPath, destPath);
      copiedFiles.push(fileName);
      console.log(`Copied: ${fileName}`);
    } catch (error) {
      console.error(`Error copying ${fileName}:`, error.message);
    }
  }

  return copiedFiles;
};

/**
 * Verifica che i file del modello esistano
 * @param {number} projectId - ID del progetto
 * @returns {Promise<boolean>} true se i file esistono
 */
const verifyModelFiles = async (projectId) => {
  const modelDir = `/Volumes/T7/projects/${projectId}/model`;

  try {
    const files = await fs.promises.readdir(modelDir);
    const hasUsdz = files.some(f => f.endsWith('.usdz'));
    const hasObj = files.some(f => f.endsWith('.obj'));

    return {
      exists: files.length > 0,
      hasUsdz,
      hasObj,
      files
    };
  } catch (error) {
    return { exists: false, hasUsdz: false, hasObj: false, files: [] };
  }
};

module.exports = {
  createTestProject,
  deleteTestProject,
  getProjectStatus,
  uploadSampleImages,
  copyLocalSampleImages,
  cleanupStorage,
  cleanupLocalFiles,
  waitForStatus,
  sendToQueue,
  verifyModelFiles,
  SAMPLE_IMAGES_PATH,
};
