/**
 * Unit Tests: Best Practices
 *
 * Verifica che le best practices siano state implementate correttamente:
 * - dotenv centralizzato (un solo punto di caricamento)
 * - AMQP Promise API con reconnection
 * - Telegram async/await
 * - package.json corretto
 * - .gitignore aggiornato
 *
 * ESECUZIONE:
 *   node --test test/unit/bestPractices.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '../../src');

// Helper: legge un file sorgente
const readSource = (relativePath) =>
  fs.readFileSync(path.join(__dirname, '../../', relativePath), 'utf8');

// ============================================================
// Tests: dotenv centralizzato
// ============================================================

describe('dotenv - Un solo punto di caricamento', () => {
  const filesToCheck = [
    'src/ProcessManager.js',
    'src/lib/s3Client.js',
    'src/lib/s3Api.js',
    'src/lib/supabaseClient.js',
    'src/lib/telegramClient.js',
    'src/utils/s3.js',
    'src/utils/db.js',
    'src/utils/telegram.js',
  ];

  for (const file of filesToCheck) {
    it(`${file} non chiama dotenv.config()`, () => {
      const source = readSource(file);
      assert.ok(
        !source.includes('dotenv'),
        `${file} should not import or call dotenv (handled by config.js)`
      );
    });
  }

  it('config.js e\' l\'unico file che chiama dotenv.config()', () => {
    const configSource = readSource('src/config.js');
    assert.ok(
      configSource.includes("require('dotenv').config()"),
      'config.js should call dotenv.config()'
    );
  });
});

// ============================================================
// Tests: Tutti i moduli usano config.js
// ============================================================

describe('config.js - Usato da tutti i moduli', () => {
  const filesUsingConfig = [
    'src/lib/s3Client.js',
    'src/lib/supabaseClient.js',
    'src/lib/telegramClient.js',
    'src/utils/s3.js',
    'src/ProcessManager.js',
  ];

  for (const file of filesUsingConfig) {
    it(`${file} importa config.js`, () => {
      const source = readSource(file);
      assert.ok(
        source.includes("require('../config')") || source.includes("require('./config')"),
        `${file} should import from config.js`
      );
    });
  }

  const filesNotUsingProcessEnv = [
    'src/lib/s3Client.js',
    'src/lib/supabaseClient.js',
    'src/lib/telegramClient.js',
  ];

  for (const file of filesNotUsingProcessEnv) {
    it(`${file} non usa process.env direttamente`, () => {
      const source = readSource(file);
      assert.ok(
        !source.includes('process.env'),
        `${file} should use config module, not process.env directly`
      );
    });
  }
});

// ============================================================
// Tests: Telegram async/await
// ============================================================

describe('Telegram - Funzioni async con await', () => {
  const telegramSource = readSource('src/utils/telegram.js');
  const pmSource = readSource('src/ProcessManager.js');

  it('sendMessage e\' async', () => {
    assert.ok(
      telegramSource.includes('const sendMessage = async'),
      'sendMessage should be async'
    );
  });

  it('sendMessage fa await su bot.telegram.sendMessage', () => {
    assert.ok(
      telegramSource.includes('await bot.telegram.sendMessage'),
      'sendMessage should await the telegram API call'
    );
  });

  it('sendDocument e\' async', () => {
    assert.ok(
      telegramSource.includes('const sendDocument = async'),
      'sendDocument should be async'
    );
  });

  it('sendDocument non ha try-catch ridondante', () => {
    assert.ok(
      !telegramSource.includes('throw error'),
      'Should not have redundant catch-and-rethrow'
    );
  });

  it('ProcessManager.notifyTelegram usa await su sendMessage', () => {
    assert.ok(
      pmSource.includes('await sendMessage('),
      'notifyTelegram should await sendMessage calls'
    );
  });
});

// ============================================================
// Tests: AMQP Promise API con reconnection
// ============================================================

describe('AMQP - Promise API e reconnection', () => {
  const queueSource = readSource('src/processQueue.js');

  it('usa amqplib Promise API (non callback_api)', () => {
    assert.ok(
      queueSource.includes("require('amqplib')"),
      'Should import amqplib (Promise API)'
    );
    assert.ok(
      !queueSource.includes('callback_api'),
      'Should NOT use callback_api'
    );
  });

  it('implementa connectWithRetry', () => {
    assert.ok(
      queueSource.includes('connectWithRetry'),
      'Should have connectWithRetry function'
    );
  });

  it('usa exponential backoff nella reconnection', () => {
    assert.ok(
      queueSource.includes('Math.pow(2, attempt)'),
      'Should use exponential backoff'
    );
    assert.ok(
      queueSource.includes('Math.min('),
      'Should cap the backoff delay'
    );
  });

  it('gestisce la riconnessione automatica su close inaspettato', () => {
    assert.ok(
      queueSource.includes("on('close'"),
      'Should handle connection close event'
    );
    assert.ok(
      queueSource.includes('reconnecting'),
      'Should attempt reconnection on unexpected close'
    );
  });

  it('configura Dead Letter Queue', () => {
    assert.ok(
      queueSource.includes('-dlq'),
      'Should configure a dead letter queue'
    );
    assert.ok(
      queueSource.includes('x-dead-letter-exchange'),
      'Should set DLQ exchange argument'
    );
  });

  it('fa nack (non ack) su errore di processing', () => {
    assert.ok(
      queueSource.includes('channel.nack(msg, false, false)'),
      'Should nack failed messages (to DLQ, not requeue)'
    );
  });

  it('ha un handler per unhandledRejection', () => {
    assert.ok(
      queueSource.includes("process.on('unhandledRejection'"),
      'Should handle unhandled rejections'
    );
  });
});

// ============================================================
// Tests: Graceful shutdown con timeout
// ============================================================

describe('Graceful Shutdown', () => {
  const queueSource = readSource('src/processQueue.js');

  it('gestisce SIGINT e SIGTERM', () => {
    assert.ok(queueSource.includes("'SIGINT'"));
    assert.ok(queueSource.includes("'SIGTERM'"));
  });

  it('ha un timeout forzato per lo shutdown', () => {
    assert.ok(
      queueSource.includes('forceExit'),
      'Should have a force exit timeout'
    );
    assert.ok(
      queueSource.includes('10000'),
      'Should have 10 second timeout'
    );
  });

  it('pulisce il timeout dopo shutdown riuscito', () => {
    assert.ok(
      queueSource.includes('clearTimeout(forceExit)'),
      'Should clear force exit timeout after successful shutdown'
    );
  });
});

// ============================================================
// Tests: package.json
// ============================================================

describe('package.json - Configurazione corretta', () => {
  const pkg = JSON.parse(readSource('package.json'));

  it('main punta a src/processQueue.js', () => {
    assert.equal(pkg.main, 'src/processQueue.js');
  });

  it('non ha "path" come dipendenza (e\' built-in)', () => {
    assert.equal(pkg.dependencies.path, undefined);
  });

  it('non ha "fastq" come dipendenza (non usato)', () => {
    assert.equal(pkg.dependencies.fastq, undefined);
  });

  it('ha "dotenv" in dependencies (non devDependencies)', () => {
    assert.ok(pkg.dependencies.dotenv, 'dotenv should be in dependencies');
    assert.equal(pkg.devDependencies?.dotenv, undefined, 'dotenv should NOT be in devDependencies');
  });

  it('ha il campo engines con Node >= 22', () => {
    assert.ok(pkg.engines, 'Should have engines field');
    assert.ok(pkg.engines.node, 'Should specify node version');
    assert.ok(
      pkg.engines.node.includes('22'),
      'Should require Node.js 22+'
    );
  });

  it('ha zod come dipendenza', () => {
    assert.ok(pkg.dependencies.zod, 'Should have zod');
  });

  it('ha @smithy/node-http-handler come dipendenza', () => {
    assert.ok(
      pkg.dependencies['@smithy/node-http-handler'],
      'Should have @smithy/node-http-handler'
    );
  });

  it('ha p-limit come dipendenza', () => {
    assert.ok(pkg.dependencies['p-limit'], 'Should have p-limit');
  });

  it('script dev usa --env-file', () => {
    assert.ok(
      pkg.scripts.dev.includes('--env-file'),
      'dev script should use Node.js native --env-file flag'
    );
  });
});

// ============================================================
// Tests: .gitignore
// ============================================================

describe('.gitignore', () => {
  const gitignore = readSource('.gitignore');

  it('include .DS_Store', () => {
    assert.ok(
      gitignore.includes('.DS_Store'),
      'Should ignore .DS_Store files'
    );
  });

  it('include node_modules', () => {
    assert.ok(
      gitignore.includes('node_modules'),
      'Should ignore node_modules'
    );
  });

  it('include .env', () => {
    assert.ok(
      gitignore.includes('.env'),
      'Should ignore .env files'
    );
  });

  it('include *.log', () => {
    assert.ok(
      gitignore.includes('*.log'),
      'Should ignore log files'
    );
  });
});

// ============================================================
// Tests: .env.example
// ============================================================

describe('.env.example', () => {
  const envExample = readSource('.env.example');

  it('documenta PROJECTS_BASE_DIR', () => {
    assert.ok(
      envExample.includes('PROJECTS_BASE_DIR'),
      'Should document PROJECTS_BASE_DIR variable'
    );
  });

  it('documenta tutte le variabili obbligatorie', () => {
    const requiredVars = [
      'SUPABASE_URL',
      'SUPABASE_KEY',
      'BOT_TOKEN',
      'CLOUDFLARE_R2_ACCOUNT_ID',
      'CLOUDFLARE_R2_ACCESS_KEY_ID',
      'CLOUDFLARE_R2_SECRET_ACCESS_KEY',
      'QUEUE_CONNECTION_STRING',
      'BUCKET',
    ];

    for (const v of requiredVars) {
      assert.ok(
        envExample.includes(v),
        `.env.example should document ${v}`
      );
    }
  });
});
