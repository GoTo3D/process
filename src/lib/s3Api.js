const {
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} = require('@aws-sdk/client-s3');

const clientS3 = require('./s3Client');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const getObject = async (Bucket, Key, retries = 3) => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await clientS3.send(new GetObjectCommand({ Bucket, Key }));
      return Buffer.from(await response.Body.transformToByteArray());
    } catch (error) {
      console.error(`Attempt ${attempt}/${retries} failed for ${Key}:`, error.message);

      if (attempt === retries) {
        throw new Error(`Failed to download file after ${retries} attempts: ${error.message}`);
      }

      await sleep(Math.pow(2, attempt) * 1000);
    }
  }
};

const putObject = async (Bucket, Key, Body) => {
  return clientS3.send(new PutObjectCommand({ Bucket, Key, Body }));
};

const deleteObject = async (Bucket, Key) => {
  return clientS3.send(new DeleteObjectCommand({ Bucket, Key }));
};

const listObjects = async (Bucket, Prefix) => {
  const response = await clientS3.send(new ListObjectsV2Command({ Bucket, Prefix }));
  return (response.Contents || []).map(obj => obj.Key);
};

module.exports = { getObject, putObject, deleteObject, listObjects };
