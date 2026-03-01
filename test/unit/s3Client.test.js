/**
 * Unit Tests: S3 Client Configuration
 *
 * Verifica che il client S3 sia configurato correttamente per
 * Cloudflare R2: NodeHttpHandler, TLS, connection pooling.
 *
 * ESECUZIONE:
 *   node --test test/unit/s3Client.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

describe('S3 Client Configuration (source analysis)', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/lib/s3Client.js'),
    'utf8'
  );

  it('usa NodeHttpHandler (non https.Agent diretto)', () => {
    assert.ok(
      source.includes('NodeHttpHandler'),
      'Should use NodeHttpHandler from @smithy/node-http-handler'
    );
    assert.ok(
      source.includes("require('@smithy/node-http-handler')"),
      'Should import from @smithy/node-http-handler'
    );
  });

  it('configura un httpsAgent dentro NodeHttpHandler', () => {
    assert.ok(
      source.includes('httpsAgent'),
      'Should configure httpsAgent inside NodeHttpHandler'
    );
  });

  it('abilita keepAlive per connection pooling', () => {
    assert.ok(
      source.includes('keepAlive: true'),
      'Should enable keepAlive for connection reuse'
    );
  });

  it('configura TLS 1.2 minimo', () => {
    assert.ok(
      source.includes("minVersion: 'TLSv1.2'"),
      'Should enforce TLS 1.2 minimum'
    );
  });

  it('abilita verifica certificati TLS', () => {
    assert.ok(
      source.includes('rejectUnauthorized: true'),
      'Should reject unauthorized TLS certificates'
    );
  });

  it('non usa tls config duplicata a livello S3Client', () => {
    // La config TLS deve essere solo dentro l'httpsAgent
    const lines = source.split('\n');
    let inHandlerBlock = false;
    let tlsOutsideHandler = false;

    for (const line of lines) {
      if (line.includes('requestHandler')) inHandlerBlock = true;
      if (!inHandlerBlock && line.includes('tls:')) {
        tlsOutsideHandler = true;
      }
    }

    assert.ok(
      !tlsOutsideHandler,
      'Should not have tls config outside requestHandler'
    );
  });

  it('usa config module (non process.env direttamente)', () => {
    assert.ok(
      source.includes("require('../config')"),
      'Should import from centralized config module'
    );
    assert.ok(
      !source.includes('dotenv'),
      'Should not require dotenv (handled by config.js)'
    );
  });

  it('configura forcePathStyle per compatibilita\' R2', () => {
    assert.ok(
      source.includes('forcePathStyle: true'),
      'Should use path-style addressing for R2 compatibility'
    );
  });
});

describe('@smithy/node-http-handler - Runtime check', () => {
  it('NodeHttpHandler e\' istanziabile', () => {
    const { NodeHttpHandler } = require('@smithy/node-http-handler');
    const https = require('https');

    const handler = new NodeHttpHandler({
      connectionTimeout: 5000,
      socketTimeout: 60000,
      httpsAgent: new https.Agent({
        keepAlive: true,
        maxSockets: 50,
      })
    });

    assert.ok(handler, 'Should create NodeHttpHandler instance');
    assert.equal(typeof handler.handle, 'function', 'Should have handle method');
  });
});

describe('S3 API - Source analysis', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/lib/s3Api.js'),
    'utf8'
  );

  it('usa transformToByteArray (non stream manuale)', () => {
    assert.ok(
      source.includes('transformToByteArray'),
      'Should use SDK v3 transformToByteArray()'
    );
    assert.ok(
      !source.includes("stream.on('data'"),
      'Should not manually handle stream events'
    );
  });

  it('implementa retry con exponential backoff', () => {
    assert.ok(
      source.includes('Math.pow(2, attempt)'),
      'Should use exponential backoff'
    );
    assert.ok(
      source.includes('retries'),
      'Should accept retries parameter'
    );
  });

  it('non ha codice commentato residuo', () => {
    assert.ok(
      !source.includes('supabase.storage'),
      'Should not have commented-out Supabase code'
    );
  });
});
