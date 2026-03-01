/**
 * Unit Tests: Config - Validazione Zod delle variabili d'ambiente
 *
 * Questi test verificano che lo schema Zod in config.js validi
 * correttamente tutte le variabili d'ambiente richieste.
 *
 * NOTA: Non importiamo direttamente src/config.js perche' ha side effects
 * (chiama dotenv.config() e process.exit su errore). Testiamo lo schema
 * Zod in isolamento.
 *
 * ESECUZIONE:
 *   node --test test/unit/config.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { z } = require('zod');

// Riproduco lo schema identico a src/config.js per testarlo in isolamento
const ConfigSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_KEY: z.string().min(1),
  BOT_TOKEN: z.string().min(1),
  CLOUDFLARE_R2_ACCOUNT_ID: z.string().min(1),
  CLOUDFLARE_R2_ACCESS_KEY_ID: z.string().min(1),
  CLOUDFLARE_R2_SECRET_ACCESS_KEY: z.string().min(1),
  QUEUE_CONNECTION_STRING: z.string().min(1),
  QUEUE: z.string().default('processing-dev'),
  BUCKET: z.string().min(1),
  PROJECTS_BASE_DIR: z.string().default('/Volumes/T7/projects'),
});

// Configurazione valida completa per i test
const validEnv = {
  SUPABASE_URL: 'https://myproject.supabase.co',
  SUPABASE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test',
  BOT_TOKEN: '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
  CLOUDFLARE_R2_ACCOUNT_ID: 'abc123def456',
  CLOUDFLARE_R2_ACCESS_KEY_ID: 'AKID_TEST_KEY',
  CLOUDFLARE_R2_SECRET_ACCESS_KEY: 'secret_test_key_value',
  QUEUE_CONNECTION_STRING: 'amqp://user:pass@localhost:5672',
  BUCKET: 'my-bucket',
};

describe('ConfigSchema - Validazione completa', () => {
  it('accetta una configurazione valida completa', () => {
    const result = ConfigSchema.safeParse(validEnv);
    assert.equal(result.success, true);
    assert.equal(result.data.SUPABASE_URL, validEnv.SUPABASE_URL);
    assert.equal(result.data.BUCKET, 'my-bucket');
  });

  it('applica i valori di default per QUEUE e PROJECTS_BASE_DIR', () => {
    const result = ConfigSchema.safeParse(validEnv);
    assert.equal(result.success, true);
    assert.equal(result.data.QUEUE, 'processing-dev');
    assert.equal(result.data.PROJECTS_BASE_DIR, '/Volumes/T7/projects');
  });

  it('permette di sovrascrivere i valori di default', () => {
    const result = ConfigSchema.safeParse({
      ...validEnv,
      QUEUE: 'processing-prod',
      PROJECTS_BASE_DIR: '/data/projects',
    });
    assert.equal(result.success, true);
    assert.equal(result.data.QUEUE, 'processing-prod');
    assert.equal(result.data.PROJECTS_BASE_DIR, '/data/projects');
  });
});

describe('ConfigSchema - SUPABASE_URL', () => {
  it('rifiuta URL non validi', () => {
    const result = ConfigSchema.safeParse({ ...validEnv, SUPABASE_URL: 'not-a-url' });
    assert.equal(result.success, false);
  });

  it('rifiuta stringhe vuote', () => {
    const result = ConfigSchema.safeParse({ ...validEnv, SUPABASE_URL: '' });
    assert.equal(result.success, false);
  });

  it('accetta URL HTTPS validi', () => {
    const result = ConfigSchema.safeParse({ ...validEnv, SUPABASE_URL: 'https://example.supabase.co' });
    assert.equal(result.success, true);
  });
});

describe('ConfigSchema - Variabili obbligatorie', () => {
  const requiredFields = [
    'SUPABASE_URL',
    'SUPABASE_KEY',
    'BOT_TOKEN',
    'CLOUDFLARE_R2_ACCOUNT_ID',
    'CLOUDFLARE_R2_ACCESS_KEY_ID',
    'CLOUDFLARE_R2_SECRET_ACCESS_KEY',
    'QUEUE_CONNECTION_STRING',
    'BUCKET',
  ];

  for (const field of requiredFields) {
    it(`fallisce se manca ${field}`, () => {
      const env = { ...validEnv };
      delete env[field];
      const result = ConfigSchema.safeParse(env);
      assert.equal(result.success, false, `Should fail without ${field}`);
    });
  }

  for (const field of ['SUPABASE_KEY', 'BOT_TOKEN', 'BUCKET']) {
    it(`rifiuta ${field} vuoto`, () => {
      const result = ConfigSchema.safeParse({ ...validEnv, [field]: '' });
      assert.equal(result.success, false, `Should reject empty ${field}`);
    });
  }
});

describe('ConfigSchema - Tolleranza (passthrough di env extra)', () => {
  it('ignora variabili d\'ambiente extra senza errori', () => {
    const result = ConfigSchema.safeParse({
      ...validEnv,
      PATH: '/usr/bin',
      HOME: '/Users/test',
      NODE_ENV: 'production',
    });
    assert.equal(result.success, true);
  });
});
