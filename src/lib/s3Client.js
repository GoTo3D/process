const { S3Client } = require('@aws-sdk/client-s3');
const { NodeHttpHandler } = require('@smithy/node-http-handler');
const https = require('https');
const config = require('../config');

const clientS3 = new S3Client({
  region: 'auto',
  endpoint: `https://${config.CLOUDFLARE_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: config.CLOUDFLARE_R2_ACCESS_KEY_ID,
    secretAccessKey: config.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
  },
  maxAttempts: 5,
  forcePathStyle: true,
  requestHandler: new NodeHttpHandler({
    connectionTimeout: 5000,
    socketTimeout: 60000,
    httpsAgent: new https.Agent({
      keepAlive: true,
      maxSockets: 50,
      rejectUnauthorized: true,
      minVersion: 'TLSv1.2'
    })
  })
});

module.exports = clientS3;
