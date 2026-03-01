const fs = require('fs')
const { readdir, stat, readFile } = require('fs/promises')
const path = require('path')
const mime = require('mime-types')
const dotenv = require("dotenv");
const { getObject, deleteObject, putObject } = require("../lib/s3Api");
const { request } = require('undici')

dotenv.config();
const BUCKET = process.env.BUCKET;

// Domini Telegram autorizzati per SSRF prevention
const ALLOWED_TELEGRAM_HOSTS = [
  'api.telegram.org',
  'telegram.org',
];

/**
 * Sanitizza un nome file per prevenire Path Traversal
 * Rimuove caratteri pericolosi e path traversal sequences
 * @param {string} filename - Nome file da sanitizzare
 * @returns {string} Nome file sanitizzato
 */
const sanitizeFilename = (filename) => {
  if (typeof filename !== 'string') return '';
  // Rimuove path traversal e caratteri pericolosi
  return path.basename(filename).replace(/[^\w\-_.]/g, '_');
};

/**
 * Valida un URL Telegram per prevenire SSRF
 * @param {string} url - URL da validare
 * @returns {boolean} true se l'URL è valido
 */
const isValidTelegramUrl = (url) => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' &&
      ALLOWED_TELEGRAM_HOSTS.some(host => parsed.hostname.endsWith(host));
  } catch {
    return false;
  }
};

const walk = async (currentDirPath) => {
  const ret = []
  const files = await readdir(currentDirPath)
  for await (const file of files) {
    const filepath = path.join(currentDirPath, file)
    const _stat = await stat(filepath)
    const _path = path.extname(file);
    if (_stat.isFile())
      ret.push({
        file: readFile(filepath),
        filename: file,
        contentType: mime.lookup(_path),
        path: filepath.substring(currentDirPath.length + 1),
      })
    else if (_stat.isDirectory()) ret.push(...(await walk(filepath)))
  }
  return ret
}

/* Private - upload files to supabase */
const _uploadDir = async ({ file_location, bucket_location }) => {
  const ret = [];
  const files = await walk(file_location);
  console.log("Uploading files:", files.length);
  const _files = await Promise.all(files);
  for await (const { file, filename } of _files) {
    console.log("Uploading file: " + filename);
    const location = `${bucket_location}/model/${filename}`;

    await putObject(BUCKET, location, await file);
    ret.push(location);
  }

  // return the position of the files
  return ret;
};


/* Private - download files from supabase */
const _downloadFiles = async (id, files, imgDir) => {
  // create the projects/id/images folder if it doesn't exist
  await fs.promises.mkdir(imgDir, { recursive: true });

  const errors = [];

  // loop through all files to download them
  for (let i = 0; i < files.length; i++) {
    const file_name = files[i];
    // Sanitizza il nome file per prevenire Path Traversal
    const safeFileName = sanitizeFilename(file_name);
    if (!safeFileName) {
      console.warn(`Skipping invalid filename: ${file_name}`);
      continue;
    }
    const location = `${id}/images/${file_name}`;
    const localLocation = path.join(imgDir, safeFileName);

    // download the file from supabase
    console.log("Downloading", location);
    try {
      const get = await getObject(BUCKET, location);
      if (!get) {
        errors.push(`Empty response for ${location}`);
        continue;
      }
      // write the file in local folder
      await fs.promises.writeFile(localLocation, get);
      console.log("Downloaded and written", localLocation);
      // delete the file from supabase only after successful write
      await deleteObject(BUCKET, location);
    } catch (e) {
      console.error(`Error downloading ${location}:`, e.message);
      errors.push(`${location}: ${e.message}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Download errors: ${errors.join('; ')}`);
  }
};

/* Private - download files from telegram */
const _downloadFromTelegram = async (file_location, imgs) => {
  // Filtra e valida gli URL per prevenire SSRF
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

  const promises = validUrls.map((img) => request(img));
  const responses = await Promise.all(promises);

  try {
    await fs.promises.mkdir(file_location, { recursive: true });
  } catch (e) {
    console.error(e);
  }

  for (let i = 0; i < responses.length; i++) {
    const response = responses[i];
    // Sanitizza il nome file estratto dall'URL
    const rawFilename = validUrls[i].split("/").pop();
    const filename = sanitizeFilename(rawFilename);
    if (!filename) {
      console.warn(`Skipping invalid filename from URL: ${validUrls[i]}`);
      continue;
    }
    const filePath = path.join(file_location, filename);
    const fileStream = fs.createWriteStream(filePath);

    // Attende che il pipe sia completato
    await new Promise((resolve, reject) => {
      response.body.pipe(fileStream);
      fileStream.on('finish', resolve);
      fileStream.on('error', reject);
    });
    console.log("Downloaded", filename);
  }

  return responses;
};

module.exports = {
  uploadDir: _uploadDir,
  downloadFiles: _downloadFiles,
  downloadFromTelegram: _downloadFromTelegram,
}
