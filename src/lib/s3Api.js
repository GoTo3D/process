const {
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} = require("@aws-sdk/client-s3");

const clientS3 = require('./s3Client')

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const getObject = async (Bucket, Key, retries = 3) => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await clientS3.send(new GetObjectCommand({ Bucket, Key }));
      
      // Convertiamo lo stream in buffer
      const chunks = [];
      const stream = response.Body;
      
      return new Promise((resolve, reject) => {
        stream.on('data', (chunk) => chunks.push(chunk));
        stream.on('end', () => resolve(Buffer.concat(chunks)));
        stream.on('error', (err) => reject(err));
      });
      
    } catch (error) {
      console.error(`Tentativo ${attempt}/${retries} fallito per ${Key}:`, error.message);
      
      if (attempt === retries) {
        throw new Error(`Impossibile scaricare il file dopo ${retries} tentativi: ${error.message}`);
      }
      
      // Attendi prima del prossimo tentativo (exponential backoff)
      await sleep(Math.pow(2, attempt) * 1000);
    }
  }
};

const putObject = async (Bucket, Key, Body) => {
  const response = await clientS3.send(
    new PutObjectCommand({ Bucket, Key, Body }),
  );
  return response;
};

const deleteObject = async (Bucket, Key) => {
  const response = await clientS3.send(
    new DeleteObjectCommand({ Bucket, Key }),
  );
  return response;
};

module.exports = { getObject, putObject, deleteObject };