/**
 * Unit Tests: ProcessManager
 *
 * Testa il comportamento di ProcessManager in isolamento:
 * - Costruttore e configurazione path
 * - Rilevamento utente Telegram
 * - Disk space check
 * - Cleanup
 * - Uso di spawn (non exec) per i processi
 *
 * NOTA: Questi test importano il modulo reale, quindi richiedono
 * che le variabili d'ambiente siano configurate (vedi .env.example).
 * Per test senza env vars, vedi security.test.js e schemas.test.js.
 *
 * ESECUZIONE:
 *   node --test test/unit/processManager.test.js
 */

const { describe, it, before, mock } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Imposta env vars minime prima di importare config
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.supabase.co';
process.env.SUPABASE_KEY = process.env.SUPABASE_KEY || 'test-key';
process.env.BOT_TOKEN = process.env.BOT_TOKEN || 'test-bot-token';
process.env.CLOUDFLARE_R2_ACCOUNT_ID = process.env.CLOUDFLARE_R2_ACCOUNT_ID || 'test-account';
process.env.CLOUDFLARE_R2_ACCESS_KEY_ID = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID || 'test-access-key';
process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || 'test-secret';
process.env.QUEUE_CONNECTION_STRING = process.env.QUEUE_CONNECTION_STRING || 'amqp://localhost';
process.env.BUCKET = process.env.BUCKET || 'test-bucket';
// Usa una dir temporanea per i test
process.env.PROJECTS_BASE_DIR = process.env.PROJECTS_BASE_DIR || os.tmpdir();

const ProcessManager = require('../../src/ProcessManager');
const config = require('../../src/config');

// ============================================================
// Tests: Constructor
// ============================================================

describe('ProcessManager - Constructor', () => {
  it('imposta i path corretti usando config.PROJECTS_BASE_DIR', () => {
    const project = {
      id: 42,
      status: 'in queue',
      files: ['photo.jpg'],
      detail: 'medium',
      feature: 'normal',
      order: 'unordered',
    };

    const pm = new ProcessManager(42, project);

    const expectedImgDir = path.join(config.PROJECTS_BASE_DIR, '42', 'images');
    const expectedOutDir = path.join(config.PROJECTS_BASE_DIR, '42', 'model');

    assert.equal(pm.imgDir, expectedImgDir);
    assert.equal(pm.outDir, expectedOutDir);
  });

  it('usa path.join (non concatenazione stringa) per i path', () => {
    const pm = new ProcessManager(123, {
      files: ['test.jpg'],
      status: 'in queue',
    });

    // path.join normalizza i separatori, a differenza della concatenazione
    assert.ok(!pm.imgDir.includes('//'), 'No double slashes in imgDir');
    assert.ok(!pm.outDir.includes('//'), 'No double slashes in outDir');
  });

  it('converte l\'id a stringa nel path', () => {
    const pm = new ProcessManager(999, {
      files: ['test.jpg'],
      status: 'in queue',
    });

    assert.ok(pm.imgDir.includes('999'));
    assert.ok(pm.outDir.includes('999'));
  });

  it('inizializza _remoteLocations come array vuoto', () => {
    const pm = new ProcessManager(1, {
      files: ['test.jpg'],
      status: 'in queue',
    });

    assert.deepEqual(pm._remoteLocations, []);
  });
});

describe('ProcessManager - Telegram detection', () => {
  it('isTelegram e\' true quando telegram_user e\' impostato', () => {
    const pm = new ProcessManager(1, {
      files: ['test.jpg'],
      status: 'in queue',
      telegram_user: 456,
    });
    assert.equal(pm.isTelegram, true);
  });

  it('isTelegram e\' false quando telegram_user e\' null', () => {
    const pm = new ProcessManager(1, {
      files: ['test.jpg'],
      status: 'in queue',
      telegram_user: null,
    });
    assert.equal(pm.isTelegram, false);
  });

  it('isTelegram e\' false quando telegram_user e\' undefined', () => {
    const pm = new ProcessManager(1, {
      files: ['test.jpg'],
      status: 'in queue',
    });
    assert.equal(pm.isTelegram, false);
  });

  it('isTelegram e\' false quando telegram_user e\' 0', () => {
    const pm = new ProcessManager(1, {
      files: ['test.jpg'],
      status: 'in queue',
      telegram_user: 0,
    });
    assert.equal(pm.isTelegram, false);
  });
});

// ============================================================
// Tests: Disk space check
// ============================================================

describe('ProcessManager - checkDiskSpace', () => {
  it('non lancia errore se lo spazio e\' sufficiente', async () => {
    const pm = new ProcessManager(1, {
      files: ['test.jpg'],
      status: 'in queue',
    });

    // Usa una directory che esiste sicuramente (tmpdir)
    // e richiedi poco spazio
    await assert.doesNotReject(
      pm.checkDiskSpace(1) // richiede solo 1MB
    );
  });

  it('lancia errore se lo spazio richiesto e\' enorme', async () => {
    const pm = new ProcessManager(1, {
      files: ['test.jpg'],
      status: 'in queue',
    });

    // Richiedi una quantita' impossibile di spazio
    await assert.rejects(
      pm.checkDiskSpace(999999999), // ~1 petabyte
      { message: /Insufficient disk space/ }
    );
  });

  it('non lancia errore se la directory non esiste (ENOENT)', async () => {
    // Sovrascrivi temporaneamente il config
    const originalBase = config.PROJECTS_BASE_DIR;
    config.PROJECTS_BASE_DIR = '/nonexistent/path/12345';

    const pm = new ProcessManager(1, {
      files: ['test.jpg'],
      status: 'in queue',
    });

    await assert.doesNotReject(pm.checkDiskSpace(1));

    // Ripristina
    config.PROJECTS_BASE_DIR = originalBase;
  });
});

// ============================================================
// Tests: cleanupAll
// ============================================================

describe('ProcessManager - cleanupAll', () => {
  it('rimuove sia imgDir che outDir', async () => {
    const testId = `test-cleanup-${Date.now()}`;
    const pm = new ProcessManager(testId, {
      files: ['test.jpg'],
      status: 'in queue',
    });

    // Crea le directory
    await fs.promises.mkdir(pm.imgDir, { recursive: true });
    await fs.promises.mkdir(pm.outDir, { recursive: true });

    // Verifica che esistano
    await assert.doesNotReject(fs.promises.access(pm.imgDir));
    await assert.doesNotReject(fs.promises.access(pm.outDir));

    // Cleanup
    await pm.cleanupAll();

    // Verifica che siano state rimosse
    await assert.rejects(fs.promises.access(pm.imgDir));
    await assert.rejects(fs.promises.access(pm.outDir));
  });

  it('non lancia errore se le directory non esistono', async () => {
    const pm = new ProcessManager('nonexistent-99999', {
      files: ['test.jpg'],
      status: 'in queue',
    });

    // Non deve lanciare errore
    await assert.doesNotReject(pm.cleanupAll());
  });
});

// ============================================================
// Tests: Factory method (create)
// ============================================================

describe('ProcessManager.create', () => {
  it('e\' un metodo statico', () => {
    assert.equal(typeof ProcessManager.create, 'function');
  });
});

// ============================================================
// Tests: Process flow (verifica che spawn sia usato, non exec)
// ============================================================

describe('ProcessManager - Sicurezza dei processi', () => {
  it('non importa exec da child_process', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../../src/ProcessManager.js'),
      'utf8'
    );

    // Verifica che non venga usato exec (vulnerabile a command injection)
    assert.ok(
      !source.includes("require('child_process').exec") &&
      !source.includes('{ exec }') &&
      !source.includes("exec("),
      'ProcessManager should not use exec()'
    );
  });

  it('usa spawn da child_process', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../../src/ProcessManager.js'),
      'utf8'
    );

    assert.ok(
      source.includes('spawn'),
      'ProcessManager should use spawn()'
    );
  });

  it('non costruisce comandi shell con template literals', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../../src/ProcessManager.js'),
      'utf8'
    );

    // Verifica che non ci siano pattern come: `cd ${x} && ./binary ${y}`
    const shellConcatPattern = /`[^`]*\$\{[^}]+\}[^`]*&&[^`]*`/;
    assert.ok(
      !shellConcatPattern.test(source),
      'Should not build shell commands with template literals and &&'
    );
  });
});
