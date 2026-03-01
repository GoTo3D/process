const fs = require('fs');
const { readdir, stat, readFile } = require('fs/promises');
const path = require('path');
const mime = require('mime-types');
const pLimit = require('p-limit');
const { getObject, deleteObject, putObject } = require('../lib/s3Api');
const { request } = require('undici');
const config = require('../config');

const BUCKET = config.BUCKET;

// Limite dimensione file (100MB)
const MAX_FILE_SIZE = 100 * 1024 * 1024;

// Domini Telegram autorizzati per SSRF prevention
const ALLOWED_TELEGRAM_HOSTS = [
  'api.telegram.org',
  'telegram.org',
];

/**
 * Sanitizza un nome file per prevenire Path Traversal
 * @param {string} filename
 * @returns {string}
 */
const sanitizeFilename = (filename) => {
  if (typeof filename !== 'string') return '';
  return path.basename(filename).replace(/[^\w\-_.]/g, '_');
};

/**
 * Valida un URL Telegram per prevenire SSRF
 * @param {string} url
 * @returns {boolean}
 */
const isValidTelegramUrl = (url) => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' &&
      ALLOWED_TELEGRAM_HOSTS.some(host =>
        parsed.hostname === host || parsed.hostname.endsWith('.' + host)
      );
  } catch {
    return false;
  }
};

/**
 * Scansiona ricorsivamente una directory e restituisce i metadati dei file.
 * Non legge il contenuto dei file (lazy).
 * @param {string} currentDirPath
 * @returns {Promise<Array<{filepath: string, filename: string, contentType: string}>>}
 */
const walk = async (currentDirPath) => {
  const ret = [];
  const files = await readdir(currentDirPath);
  for (const file of files) {
    const filepath = path.join(currentDirPath, file);
    const fileStat = await stat(filepath);
    if (fileStat.isFile()) {
      ret.push({
        filepath,
        filename: file,
        contentType: mime.lookup(path.extname(file)) || 'application/octet-stream',
      });
    } else if (fileStat.isDirectory()) {
      ret.push(...(await walk(filepath)));
    }
  }
  return ret;
};

/**
 * Upload di una directory su S3 con concorrenza limitata
 * @param {{file_location: string, bucket_location: string}} options
 * @returns {Promise<string[]>} Lista dei path S3 caricati
 */
const _uploadDir = async ({ file_location, bucket_location }) => {
  const files = await walk(file_location);
  console.log('Uploading files:', files.length);

  const limit = pLimit(5);

  const uploads = files.map((fileInfo) =>
    limit(async () => {
      const data = await readFile(fileInfo.filepath);
      const location = `${bucket_location}/model/${fileInfo.filename}`;
      console.log('Uploading file:', fileInfo.filename);
      await putObject(BUCKET, location, data);
      return location;
    })
  );

  return Promise.all(uploads);
};

/**
 * Download dei file da S3 con concorrenza limitata.
 * Non cancella i file remoti (cancellazione differita).
 * @param {string} id - ID del progetto
 * @param {string[]} files - Lista dei nomi file
 * @param {string} imgDir - Directory locale di destinazione
 * @returns {Promise<string[]>} Lista delle location S3 scaricate (per cleanup differito)
 */
const _downloadFiles = async (id, files, imgDir) => {
  await fs.promises.mkdir(imgDir, { recursive: true });

  const limit = pLimit(5);
  const errors = [];
  const downloadedLocations = [];

  const tasks = files.map((file_name) =>
    limit(async () => {
      const safeFileName = sanitizeFilename(file_name);
      if (!safeFileName) {
        console.warn(`Skipping invalid filename: ${file_name}`);
        return;
      }

      const location = `${id}/images/${file_name}`;
      const localLocation = path.join(imgDir, safeFileName);

      console.log('Downloading', location);
      try {
        const data = await getObject(BUCKET, location);
        if (!data) {
          errors.push(`Empty response for ${location}`);
          return;
        }
        if (data.length > MAX_FILE_SIZE) {
          console.warn(`File ${location} exceeds size limit (${data.length} bytes), skipping`);
          return;
        }
        await fs.promises.writeFile(localLocation, data);
        console.log('Downloaded', localLocation);
        downloadedLocations.push(location);
      } catch (e) {
        console.error(`Error downloading ${location}:`, e.message);
        errors.push(`${location}: ${e.message}`);
      }
    })
  );

  await Promise.all(tasks);

  if (errors.length > 0) {
    throw new Error(`Download errors: ${errors.join('; ')}`);
  }

  return downloadedLocations;
};

/**
 * Download dei file da Telegram con concorrenza limitata
 * @param {string} file_location - Directory locale di destinazione
 * @param {string[]} imgs - Lista degli URL Telegram
 */
const _downloadFromTelegram = async (file_location, imgs) => {
  const validUrls = imgs.filter((img) => {
    if (!isValidTelegramUrl(img)) {
      console.warn(`Skipping invalid/untrusted URL: ${img}`);
      return false;
    }
    return true;
  });

  if (validUrls.length === 0) {
    throw new Error('No valid Telegram URLs to download');
  }

  await fs.promises.mkdir(file_location, { recursive: true });

  const limit = pLimit(5);

  const tasks = validUrls.map((url) =>
    limit(async () => {
      const rawFilename = url.split('/').pop();
      const filename = sanitizeFilename(rawFilename);
      if (!filename) {
        console.warn(`Skipping invalid filename from URL: ${url}`);
        return;
      }

      const response = await request(url);

      // Controllo dimensione file via Content-Length
      const contentLength = parseInt(response.headers['content-length'] || '0', 10);
      if (contentLength > MAX_FILE_SIZE) {
        console.warn(`Telegram file exceeds size limit: ${contentLength} bytes, skipping`);
        // Consuma il body per evitare leak
        await response.body.dump();
        return;
      }

      const filePath = path.join(file_location, filename);
      const fileStream = fs.createWriteStream(filePath);

      await new Promise((resolve, reject) => {
        response.body.pipe(fileStream);
        fileStream.on('finish', resolve);
        fileStream.on('error', reject);
      });

      console.log('Downloaded', filename);
    })
  );

  await Promise.all(tasks);
};

/**
 * Cancella i file remoti dallo storage (cancellazione differita)
 * @param {string[]} locations - Lista delle location S3 da cancellare
 */
const _cleanupRemoteFiles = async (locations) => {
  for (const location of locations) {
    try {
      await deleteObject(BUCKET, location);
    } catch (e) {
      console.warn(`Failed to delete remote file ${location}:`, e.message);
    }
  }
};

module.exports = {
  uploadDir: _uploadDir,
  downloadFiles: _downloadFiles,
  downloadFromTelegram: _downloadFromTelegram,
  cleanupRemoteFiles: _cleanupRemoteFiles,
};
