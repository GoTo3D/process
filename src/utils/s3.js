// const { readdir, stat, readFile } = require('fs/promises')
// const path = require('path')
// const mime = require('mime-types')
const dotenv = require("dotenv");
const { getObject, deleteObject, putObject } = require("../lib/s3Api");
const { request } = require('undici')

dotenv.config();
const BUCKET = process.env.BUCKET;

// const walk = async (currentDirPath, callback) => {
//   const ret = []
//   const files = await readdir(currentDirPath)
//   for await (const file of files) {
//     const filepath = path.join(currentDirPath, file)
//     const _stat = await stat(filepath)
//     const _path = path.extname(file);
//     console.log(_path)
//     if (_stat.isFile())
//       ret.push({
//         file: readFile(filepath),
//         filename: file,
//         contentType: mime.lookup(_path),
//         path: filepath.substring(currentDirPath.length + 1),
//       })
//     else if (_stat.isDirectory()) ret.push(...(await walk(filepath, callback)))
//   }
//   return ret
// }

/* Private - upload files to supabase */
const _uploadDir = async ({ file_location, bucket_location }) => {
  const ret = [];
  const files = await walk(file_location);
  console.log("Uploading files:", files.length);
  const _files = await Promise.all(files);
  // _files.forEach(async ({ file, path }, i) => {
  for await (const { file, filename, contentType } of _files) {
    console.log("Uploading file: " + filename);
    const location = `${bucket_location}/model/${filename}`;

    // const { data, error } = await supabase.storage
    //   .from(BUCKET)
    //   .upload(location, await file, {
    //     contentType,
    //   });

    await putObject(BUCKET, location, await file);
    ret.push(location);
  }

  // return the position of the files
  return ret;
};


/* Private - download files from supabase */
const _downloadFiles = async (id, files) => {
  try {
    const locationPath = `projects/${id}`;
    const localImageLocation = `${locationPath}/images/`;
    // create the projects/id/images folder if it doesn't exist
    await fs.promises.mkdir(localImageLocation, { recursive: true });

    // loop through all files to download them
    for (let i = 0; i < files.length; i++) {
      const file_name = files[i];
      const location = `${id}/images/${file_name}`;
      const localLocation = `${localImageLocation}${file_name}`;

      // download the file from supabase
      console.log("Downloading", location);
      // const { data: dataFiles, error: errorFiles } = await supabase.storage
      //   .from(BUCKET)
      //   .download(location);
      const get = await getObject(BUCKET, location);

      if (!get) {
        console.log("errorFiles");
        continue;
      }
      // write the file in local folder
      try {
        await fs.promises.writeFile(localLocation, get);
      } catch (e) {
        console.error(e);
      }
      // delete the file from supabase
      // await supabase.storage.from(BUCKET).remove([location]);
      await deleteObject(BUCKET, location);
    }
  } catch (error) {
    console.error(error);
  }
};

/* Private - download files from telegram */
const _downloadFromTelegram = async (file_location, imgs) => {
  const promises = imgs.map((img) => request(img));
  const responses = await Promise.all(promises);

  try {
    await fs.promises.mkdir(file_location, { recursive: true });
  } catch (e) {
    console.error(e);
  }

  for (let i = 0; i < responses.length; i++) {
    const response = responses[i];
    const filename = imgs[i].split("/").pop();
    const file = fs.createWriteStream(`${file_location}/${filename}`);
    await response.body.pipe(file);
    console.log("Downloaded", filename);
  }

  return responses;
};

module.exports = {
  uploadDir: _uploadDir,
  downloadFiles: _downloadFiles,
  downloadFromTelegram: _downloadFromTelegram,
}
