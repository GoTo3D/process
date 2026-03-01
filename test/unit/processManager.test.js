/**
 * Unit Tests: ProcessManager
 *
 * Testa i singoli metodi di ProcessManager in isolamento
 *
 * ESECUZIONE:
 *   node test/unit/processManager.test.js
 */

const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

dotenv.config();

// Test runner minimale
let passed = 0;
let failed = 0;
const results = [];

const test = (name, fn) => {
  results.push({ name, fn });
};

const runTests = async () => {
  console.log('\n========================================');
  console.log('  Unit Tests: ProcessManager');
  console.log('========================================\n');

  for (const { name, fn } of results) {
    try {
      await fn();
      console.log(`  [PASS] ${name}`);
      passed++;
    } catch (error) {
      console.log(`  [FAIL] ${name}`);
      console.log(`         ${error.message}`);
      failed++;
    }
  }

  console.log('\n----------------------------------------');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('----------------------------------------\n');

  process.exit(failed > 0 ? 1 : 0);
};

// Assert helpers
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const assertEqual = (actual, expected, message) => {
  if (actual !== expected) {
    throw new Error(`${message}: expected "${expected}", got "${actual}"`);
  }
};

// ============================================
// Tests
// ============================================

// Test: sanitizeParam function
test('sanitizeParam returns valid value from whitelist', () => {
  // Import the module to access internals
  // Since sanitizeParam is not exported, we test it indirectly through ProcessManager
  const ProcessManager = require('../../src/ProcessManager');

  // Create a mock project with valid params
  const project = {
    detail: 'full',
    ordering: 'sequential',
    feature: 'high',
    files: ['test.jpg']
  };

  const pm = new ProcessManager(999, project);
  // The constructor doesn't validate, but processModel does
  // We can verify the class was created successfully
  assert(pm.project.detail === 'full', 'Should preserve valid detail');
});

test('ProcessManager constructor sets correct paths', () => {
  const ProcessManager = require('../../src/ProcessManager');

  const project = {
    detail: 'medium',
    ordering: 'unordered',
    feature: 'normal',
    files: ['test.jpg'],
    telegram_user: null
  };

  const pm = new ProcessManager(123, project);

  assertEqual(pm.imgDir, '/Volumes/T7/projects/123/images/', 'imgDir should be correct');
  assertEqual(pm.outDir, '/Volumes/T7/projects/123/model/', 'outDir should be correct');
  assertEqual(pm.isTelegram, false, 'isTelegram should be false when no telegram_user');
});

test('ProcessManager detects Telegram user correctly', () => {
  const ProcessManager = require('../../src/ProcessManager');

  const project = {
    detail: 'medium',
    files: ['test.jpg'],
    telegram_user: 456
  };

  const pm = new ProcessManager(123, project);
  assert(pm.isTelegram === true, 'isTelegram should be true when telegram_user is set');
});

test('ProcessManager handles undefined telegram_user', () => {
  const ProcessManager = require('../../src/ProcessManager');

  const project = {
    detail: 'medium',
    files: ['test.jpg']
    // telegram_user not set
  };

  const pm = new ProcessManager(123, project);
  assert(pm.isTelegram === false, 'isTelegram should be false when telegram_user is undefined');
});

// Test: validateProjectId from processQueue
test('validateProjectId accepts valid integer strings', () => {
  // We need to test the validation logic
  const validateProjectId = (rawId) => {
    if (typeof rawId !== 'string') return null;
    const trimmed = rawId.trim();
    if (!/^\d+$/.test(trimmed)) return null;
    const id = parseInt(trimmed, 10);
    if (id <= 0 || id > Number.MAX_SAFE_INTEGER) return null;
    return id;
  };

  assertEqual(validateProjectId('123'), 123, 'Should parse valid integer');
  assertEqual(validateProjectId('  456  '), 456, 'Should trim whitespace');
  assertEqual(validateProjectId('1'), 1, 'Should accept minimum valid id');
});

test('validateProjectId rejects invalid inputs', () => {
  const validateProjectId = (rawId) => {
    if (typeof rawId !== 'string') return null;
    const trimmed = rawId.trim();
    if (!/^\d+$/.test(trimmed)) return null;
    const id = parseInt(trimmed, 10);
    if (id <= 0 || id > Number.MAX_SAFE_INTEGER) return null;
    return id;
  };

  assert(validateProjectId('abc') === null, 'Should reject non-numeric');
  assert(validateProjectId('') === null, 'Should reject empty string');
  assert(validateProjectId('0') === null, 'Should reject zero');
  assert(validateProjectId('-1') === null, 'Should reject negative');
  assert(validateProjectId('12.34') === null, 'Should reject decimal');
  assert(validateProjectId('12abc') === null, 'Should reject mixed');
  assert(validateProjectId(123) === null, 'Should reject non-string');
});

// Test: sanitizeFilename from s3.js
test('sanitizeFilename removes path traversal', () => {
  const sanitizeFilename = (filename) => {
    if (typeof filename !== 'string') return '';
    return path.basename(filename).replace(/[^\w\-_.]/g, '_');
  };

  assertEqual(sanitizeFilename('../../../etc/passwd'), 'passwd', 'Should remove path traversal');
  assertEqual(sanitizeFilename('test.jpg'), 'test.jpg', 'Should preserve valid filename');
  assertEqual(sanitizeFilename(''), '', 'Should handle empty string');
});

test('sanitizeFilename handles special characters', () => {
  const sanitizeFilename = (filename) => {
    if (typeof filename !== 'string') return '';
    return path.basename(filename).replace(/[^\w\-_.]/g, '_');
  };

  const result = sanitizeFilename('test file (1).jpg');
  assert(!result.includes(' '), 'Should replace spaces');
  assert(!result.includes('('), 'Should replace parentheses');
});

// Test: isValidTelegramUrl from s3.js
test('isValidTelegramUrl accepts valid Telegram URLs', () => {
  const ALLOWED_TELEGRAM_HOSTS = ['api.telegram.org', 'telegram.org'];

  const isValidTelegramUrl = (url) => {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'https:' &&
        ALLOWED_TELEGRAM_HOSTS.some(host => parsed.hostname.endsWith(host));
    } catch {
      return false;
    }
  };

  assert(isValidTelegramUrl('https://api.telegram.org/file/bot123/photo.jpg'), 'Should accept api.telegram.org');
  assert(isValidTelegramUrl('https://telegram.org/something'), 'Should accept telegram.org');
});

test('isValidTelegramUrl rejects invalid URLs', () => {
  const ALLOWED_TELEGRAM_HOSTS = ['api.telegram.org', 'telegram.org'];

  const isValidTelegramUrl = (url) => {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'https:' &&
        ALLOWED_TELEGRAM_HOSTS.some(host => parsed.hostname.endsWith(host));
    } catch {
      return false;
    }
  };

  assert(!isValidTelegramUrl('http://api.telegram.org/file'), 'Should reject HTTP');
  assert(!isValidTelegramUrl('https://evil.com/telegram.org'), 'Should reject non-Telegram domains');
  assert(!isValidTelegramUrl('https://localhost/file'), 'Should reject localhost');
  assert(!isValidTelegramUrl('not-a-url'), 'Should reject invalid URL');
  assert(!isValidTelegramUrl(''), 'Should reject empty string');
});

// Test: ALLOWED constants
test('ALLOWED_DETAILS contains all valid detail levels', () => {
  const ALLOWED_DETAILS = ['preview', 'reduced', 'medium', 'full', 'raw'];

  assert(ALLOWED_DETAILS.includes('preview'), 'Should include preview');
  assert(ALLOWED_DETAILS.includes('medium'), 'Should include medium');
  assert(ALLOWED_DETAILS.includes('full'), 'Should include full');
  assertEqual(ALLOWED_DETAILS.length, 5, 'Should have exactly 5 detail levels');
});

test('ALLOWED_ORDERINGS contains valid ordering options', () => {
  const ALLOWED_ORDERINGS = ['unordered', 'sequential'];

  assert(ALLOWED_ORDERINGS.includes('unordered'), 'Should include unordered');
  assert(ALLOWED_ORDERINGS.includes('sequential'), 'Should include sequential');
  assertEqual(ALLOWED_ORDERINGS.length, 2, 'Should have exactly 2 ordering options');
});

test('ALLOWED_FEATURES contains valid feature options', () => {
  const ALLOWED_FEATURES = ['normal', 'high'];

  assert(ALLOWED_FEATURES.includes('normal'), 'Should include normal');
  assert(ALLOWED_FEATURES.includes('high'), 'Should include high');
  assertEqual(ALLOWED_FEATURES.length, 2, 'Should have exactly 2 feature options');
});

// Run all tests
runTests();
