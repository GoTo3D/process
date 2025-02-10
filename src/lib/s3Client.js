const { S3Client } = require("@aws-sdk/client-s3");
const https = require('https');

const {
  CLOUDFLARE_R2_ACCOUNT_ID,
  CLOUDFLARE_R2_ACCESS_KEY_ID,
  CLOUDFLARE_R2_SECRET_ACCESS_KEY,
} = process.env;

const s3ClientConfig = {
  region: "auto",
  endpoint: `https://${CLOUDFLARE_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: CLOUDFLARE_R2_ACCESS_KEY_ID || "",
    secretAccessKey: CLOUDFLARE_R2_SECRET_ACCESS_KEY || "",
  },
  maxAttempts: 5,
  requestTimeout: 60000,
  forcePathStyle: true,
  requestHandler: new https.Agent({
    keepAlive: true,
    maxSockets: 50,
    rejectUnauthorized: false,
    secureProtocol: 'TLSv1_2_method'
  })
};

const clientS3 = new S3Client(s3ClientConfig);

module.exports = clientS3;
