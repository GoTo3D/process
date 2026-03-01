const { S3Client } = require("@aws-sdk/client-s3");
const https = require('https');
const dotenv = require('dotenv');

dotenv.config();

const {
  CLOUDFLARE_R2_ACCOUNT_ID,
  CLOUDFLARE_R2_ACCESS_KEY_ID,
  CLOUDFLARE_R2_SECRET_ACCESS_KEY,
} = process.env;

// Validazione credenziali obbligatorie
if (!CLOUDFLARE_R2_ACCOUNT_ID) {
  throw new Error('CLOUDFLARE_R2_ACCOUNT_ID environment variable is required');
}
if (!CLOUDFLARE_R2_ACCESS_KEY_ID) {
  throw new Error('CLOUDFLARE_R2_ACCESS_KEY_ID environment variable is required');
}
if (!CLOUDFLARE_R2_SECRET_ACCESS_KEY) {
  throw new Error('CLOUDFLARE_R2_SECRET_ACCESS_KEY environment variable is required');
}

const s3ClientConfig = {
  region: "auto",
  endpoint: `https://${CLOUDFLARE_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: CLOUDFLARE_R2_ACCESS_KEY_ID,
    secretAccessKey: CLOUDFLARE_R2_SECRET_ACCESS_KEY,
  },
  tls: {
    rejectUnauthorized: true,
    minVersion: 'TLSv1.2'
  },
  maxAttempts: 5,
  requestTimeout: 60000,
  forcePathStyle: true,
  requestHandler: new https.Agent({
    connectionTimeout: 5000,
    socketTimeout: 5000,
    keepAlive: true,
    maxSockets: 50,
    rejectUnauthorized: true, // Abilita verifica certificato TLS
    minVersion: 'TLSv1.2'
  })
};

const clientS3 = new S3Client(s3ClientConfig);

module.exports = clientS3;
