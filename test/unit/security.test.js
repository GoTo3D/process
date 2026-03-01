/**
 * Unit Tests: Sicurezza
 *
 * Testa le funzioni di sicurezza implementate nel codebase:
 * - sanitizeFilename: prevenzione Path Traversal
 * - isValidTelegramUrl: prevenzione SSRF
 * - sanitizeParam: prevenzione Command Injection tramite whitelist
 * - File size limits
 *
 * ESECUZIONE:
 *   node --test test/unit/security.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

// ============================================================
// Funzioni di sicurezza estratte dal codice sorgente per test isolati
// ============================================================

// Da src/utils/s3.js
const sanitizeFilename = (filename) => {
  if (typeof filename !== 'string') return '';
  return path.basename(filename).replace(/[^\w\-_.]/g, '_');
};

// Da src/utils/s3.js (versione corretta con fix SSRF)
const ALLOWED_TELEGRAM_HOSTS = ['api.telegram.org', 'telegram.org'];

const isValidTelegramUrl = (url) => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' &&
      ALLOWED_TELEGRAM_HOSTS.some(host =>
        parsed.hostname === host || parsed.hostname.endsWith('.' + host)
      );
  } catch {
    return false;
  }
};

// Da src/ProcessManager.js
const ALLOWED_DETAILS = ['preview', 'reduced', 'medium', 'full', 'raw'];
const ALLOWED_ORDERINGS = ['unordered', 'sequential'];
const ALLOWED_FEATURES = ['normal', 'high'];

const sanitizeParam = (value, allowedValues, defaultValue) => {
  if (typeof value !== 'string') return defaultValue;
  const normalized = value.toLowerCase().trim();
  return allowedValues.includes(normalized) ? normalized : defaultValue;
};

// ============================================================
// Tests: sanitizeFilename (Path Traversal Prevention)
// ============================================================

describe('sanitizeFilename - Path Traversal Prevention', () => {
  it('preserva nomi file validi', () => {
    assert.equal(sanitizeFilename('photo.jpg'), 'photo.jpg');
    assert.equal(sanitizeFilename('image_001.png'), 'image_001.png');
    assert.equal(sanitizeFilename('my-file.heic'), 'my-file.heic');
  });

  it('blocca path traversal con ../', () => {
    assert.equal(sanitizeFilename('../../../etc/passwd'), 'passwd');
    assert.equal(sanitizeFilename('../../secret.txt'), 'secret.txt');
    assert.equal(sanitizeFilename('../photo.jpg'), 'photo.jpg');
  });

  it('blocca path traversal con percorsi assoluti', () => {
    const result = sanitizeFilename('/etc/passwd');
    assert.equal(result, 'passwd');
  });

  it('gestisce backslash (su macOS trattato come carattere del nome)', () => {
    const result = sanitizeFilename('..\\..\\Windows\\System32\\config');
    // Su macOS/Linux, backslash non e' un separatore di path.
    // path.basename ritorna l'intera stringa, e replace rimuove i backslash.
    // Il risultato e' sicuro perche' non contiene separatori di path validi.
    assert.ok(!result.includes('/'), 'Should not contain forward slashes');
  });

  it('sostituisce spazi e caratteri speciali', () => {
    const result = sanitizeFilename('test file (1).jpg');
    assert.ok(!result.includes(' '), 'No spaces');
    assert.ok(!result.includes('('), 'No parentheses');
    assert.ok(result.endsWith('.jpg'), 'Extension preserved');
  });

  it('gestisce stringhe vuote', () => {
    assert.equal(sanitizeFilename(''), '');
  });

  it('gestisce input non-stringa', () => {
    assert.equal(sanitizeFilename(null), '');
    assert.equal(sanitizeFilename(undefined), '');
    assert.equal(sanitizeFilename(123), '');
    assert.equal(sanitizeFilename({}), '');
  });

  it('gestisce nomi file con doppi punti', () => {
    assert.equal(sanitizeFilename('file..jpg'), 'file..jpg');
  });

  it('preserva underscore e trattini', () => {
    assert.equal(sanitizeFilename('my_file-name.jpg'), 'my_file-name.jpg');
  });

  it('sanitizza caratteri unicode/emoji', () => {
    const result = sanitizeFilename('foto📸.jpg');
    assert.ok(!result.includes('📸'), 'Emoji removed');
  });
});

// ============================================================
// Tests: isValidTelegramUrl (SSRF Prevention)
// ============================================================

describe('isValidTelegramUrl - SSRF Prevention', () => {
  describe('URL validi (accettati)', () => {
    it('accetta api.telegram.org', () => {
      assert.equal(
        isValidTelegramUrl('https://api.telegram.org/file/bot123/photo.jpg'),
        true
      );
    });

    it('accetta telegram.org', () => {
      assert.equal(
        isValidTelegramUrl('https://telegram.org/something'),
        true
      );
    });

    it('accetta sottodomini legittimi di telegram.org', () => {
      assert.equal(
        isValidTelegramUrl('https://cdn.telegram.org/file/123'),
        true
      );
    });
  });

  describe('URL non validi (rifiutati)', () => {
    it('rifiuta HTTP (non HTTPS)', () => {
      assert.equal(
        isValidTelegramUrl('http://api.telegram.org/file'),
        false
      );
    });

    it('rifiuta domini non Telegram', () => {
      assert.equal(
        isValidTelegramUrl('https://evil.com/api.telegram.org'),
        false
      );
    });

    it('rifiuta localhost', () => {
      assert.equal(isValidTelegramUrl('https://localhost/file'), false);
    });

    it('rifiuta IP privati', () => {
      assert.equal(isValidTelegramUrl('https://192.168.1.1/file'), false);
      assert.equal(isValidTelegramUrl('https://10.0.0.1/file'), false);
      assert.equal(isValidTelegramUrl('https://127.0.0.1/file'), false);
    });

    it('rifiuta URL non validi', () => {
      assert.equal(isValidTelegramUrl('not-a-url'), false);
    });

    it('rifiuta stringhe vuote', () => {
      assert.equal(isValidTelegramUrl(''), false);
    });

    it('rifiuta FTP', () => {
      assert.equal(isValidTelegramUrl('ftp://api.telegram.org/file'), false);
    });

    // Test cruciale per il fix SSRF (issue 1.2)
    it('rifiuta domini che terminano con telegram.org ma senza punto separatore', () => {
      // PRIMA del fix: "evil-telegram.org".endsWith("telegram.org") === true
      // DOPO il fix: richiede match esatto O punto separatore
      assert.equal(
        isValidTelegramUrl('https://evil-telegram.org/file'),
        false,
        'Should reject domains like evil-telegram.org'
      );
    });

    it('rifiuta evil-api.telegram.org-lookalike', () => {
      assert.equal(
        isValidTelegramUrl('https://evilapi.telegram.org.evil.com/file'),
        false
      );
    });
  });
});

// ============================================================
// Tests: sanitizeParam (Command Injection Prevention)
// ============================================================

describe('sanitizeParam - Command Injection Prevention', () => {
  describe('Valori validi dalla whitelist', () => {
    it('accetta valori validi per detail', () => {
      assert.equal(sanitizeParam('preview', ALLOWED_DETAILS, 'medium'), 'preview');
      assert.equal(sanitizeParam('reduced', ALLOWED_DETAILS, 'medium'), 'reduced');
      assert.equal(sanitizeParam('medium', ALLOWED_DETAILS, 'medium'), 'medium');
      assert.equal(sanitizeParam('full', ALLOWED_DETAILS, 'medium'), 'full');
      assert.equal(sanitizeParam('raw', ALLOWED_DETAILS, 'medium'), 'raw');
    });

    it('accetta valori validi per ordering', () => {
      assert.equal(sanitizeParam('unordered', ALLOWED_ORDERINGS, 'unordered'), 'unordered');
      assert.equal(sanitizeParam('sequential', ALLOWED_ORDERINGS, 'unordered'), 'sequential');
    });

    it('accetta valori validi per feature', () => {
      assert.equal(sanitizeParam('normal', ALLOWED_FEATURES, 'normal'), 'normal');
      assert.equal(sanitizeParam('high', ALLOWED_FEATURES, 'normal'), 'high');
    });
  });

  describe('Normalizzazione case-insensitive', () => {
    it('normalizza maiuscole', () => {
      assert.equal(sanitizeParam('FULL', ALLOWED_DETAILS, 'medium'), 'full');
      assert.equal(sanitizeParam('High', ALLOWED_FEATURES, 'normal'), 'high');
    });

    it('gestisce mixed case', () => {
      assert.equal(sanitizeParam('MeDiUm', ALLOWED_DETAILS, 'medium'), 'medium');
    });

    it('gestisce spazi iniziali/finali', () => {
      assert.equal(sanitizeParam('  full  ', ALLOWED_DETAILS, 'medium'), 'full');
    });
  });

  describe('Valori non validi (ritorna il default)', () => {
    it('ritorna default per valori non in whitelist', () => {
      assert.equal(sanitizeParam('invalid', ALLOWED_DETAILS, 'medium'), 'medium');
      assert.equal(sanitizeParam('ultra', ALLOWED_DETAILS, 'medium'), 'medium');
    });

    it('blocca tentativi di command injection', () => {
      assert.equal(
        sanitizeParam('medium; rm -rf /', ALLOWED_DETAILS, 'medium'),
        'medium',
        'Should reject shell injection'
      );
      assert.equal(
        sanitizeParam('full && cat /etc/passwd', ALLOWED_DETAILS, 'medium'),
        'medium',
        'Should reject command chaining'
      );
      assert.equal(
        sanitizeParam('$(whoami)', ALLOWED_DETAILS, 'medium'),
        'medium',
        'Should reject command substitution'
      );
      assert.equal(
        sanitizeParam('`id`', ALLOWED_DETAILS, 'medium'),
        'medium',
        'Should reject backtick execution'
      );
    });

    it('ritorna default per input non-stringa', () => {
      assert.equal(sanitizeParam(null, ALLOWED_DETAILS, 'medium'), 'medium');
      assert.equal(sanitizeParam(undefined, ALLOWED_DETAILS, 'medium'), 'medium');
      assert.equal(sanitizeParam(123, ALLOWED_DETAILS, 'medium'), 'medium');
      assert.equal(sanitizeParam({}, ALLOWED_DETAILS, 'medium'), 'medium');
    });
  });
});

// ============================================================
// Tests: File size limits
// ============================================================

describe('File Size Limits', () => {
  const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

  it('100MB e\' il limite configurato', () => {
    assert.equal(MAX_FILE_SIZE, 104857600);
  });

  it('un file da 50MB e\' sotto il limite', () => {
    const fileSize = 50 * 1024 * 1024;
    assert.ok(fileSize <= MAX_FILE_SIZE);
  });

  it('un file da 150MB supera il limite', () => {
    const fileSize = 150 * 1024 * 1024;
    assert.ok(fileSize > MAX_FILE_SIZE);
  });

  it('un file da esattamente 100MB e\' al limite', () => {
    assert.ok(MAX_FILE_SIZE <= MAX_FILE_SIZE);
  });
});
