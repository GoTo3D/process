const {
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} = require("@aws-sdk/client-s3");

const clientS3 = require('./s3Client')

const getObject = async (Bucket, Key) => {
  const response = await clientS3.send(new GetObjectCommand({ Bucket, Key }));
  return response.Body;
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