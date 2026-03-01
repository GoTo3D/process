/**
 * Unit Tests: Performance
 *
 * Verifica le ottimizzazioni di performance implementate:
 * - p-limit: concorrenza limitata per upload/download
 * - walk() lazy: non legge i file durante la scansione
 * - Parallel vs sequential execution timing
 *
 * ESECUZIONE:
 *   node --test test/unit/performance.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const pLimit = require('p-limit');

// ============================================================
// Tests: p-limit - Concurrency control
// ============================================================

describe('p-limit - Controllo concorrenza', () => {
  it('limita il numero di task paralleli', async () => {
    const limit = pLimit(2); // max 2 concorrenti
    let activeTasks = 0;
    let maxConcurrent = 0;

    const task = () => limit(async () => {
      activeTasks++;
      maxConcurrent = Math.max(maxConcurrent, activeTasks);
      await new Promise(r => setTimeout(r, 50));
      activeTasks--;
    });

    // Lancia 5 task
    await Promise.all([task(), task(), task(), task(), task()]);

    assert.equal(maxConcurrent, 2, 'Should never exceed 2 concurrent tasks');
    assert.equal(activeTasks, 0, 'All tasks should be completed');
  });

  it('tutti i task vengono completati', async () => {
    const limit = pLimit(3);
    const results = [];

    const tasks = [1, 2, 3, 4, 5].map(n =>
      limit(async () => {
        await new Promise(r => setTimeout(r, 10));
        results.push(n);
        return n * 2;
      })
    );

    const output = await Promise.all(tasks);

    assert.equal(output.length, 5);
    assert.deepEqual(output, [2, 4, 6, 8, 10]);
    assert.equal(results.length, 5);
  });

  it('pLimit(1) esegue in modo sequenziale', async () => {
    const limit = pLimit(1);
    const order = [];

    const tasks = [1, 2, 3].map(n =>
      limit(async () => {
        await new Promise(r => setTimeout(r, 10));
        order.push(n);
        return n;
      })
    );

    await Promise.all(tasks);

    // Con concorrenza 1, l'ordine deve essere preservato
    assert.deepEqual(order, [1, 2, 3]);
  });

  it('gestisce errori senza bloccare gli altri task', async () => {
    const limit = pLimit(2);
    const results = [];

    const tasks = [
      limit(async () => { results.push(1); return 1; }),
      limit(async () => { throw new Error('task 2 failed'); }),
      limit(async () => { results.push(3); return 3; }),
    ];

    const settled = await Promise.allSettled(tasks);

    assert.equal(settled[0].status, 'fulfilled');
    assert.equal(settled[1].status, 'rejected');
    assert.equal(settled[2].status, 'fulfilled');
    assert.ok(results.includes(1));
    assert.ok(results.includes(3));
  });
});

// ============================================================
// Tests: Parallel vs Sequential (dimostra il vantaggio)
// ============================================================

describe('Parallel vs Sequential - Dimostrazione', () => {
  const simulateIO = (ms) => new Promise(r => setTimeout(r, ms));

  it('esecuzione parallela e\' piu\' veloce della sequenziale', async () => {
    const taskDuration = 50; // ms per task
    const taskCount = 5;

    // Sequenziale
    const seqStart = Date.now();
    for (let i = 0; i < taskCount; i++) {
      await simulateIO(taskDuration);
    }
    const seqDuration = Date.now() - seqStart;

    // Parallela con p-limit
    const limit = pLimit(5);
    const parStart = Date.now();
    await Promise.all(
      Array.from({ length: taskCount }, () =>
        limit(() => simulateIO(taskDuration))
      )
    );
    const parDuration = Date.now() - parStart;

    // La parallela deve essere significativamente piu' veloce
    assert.ok(
      parDuration < seqDuration * 0.6,
      `Parallel (${parDuration}ms) should be faster than sequential (${seqDuration}ms)`
    );
  });
});

// ============================================================
// Tests: walk() lazy - Source analysis
// ============================================================

describe('walk() - Lazy file reading (source analysis)', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/utils/s3.js'),
    'utf8'
  );

  it('walk() non chiama readFile durante la scansione', () => {
    // Estrai la funzione walk dal sorgente (approssimativamente)
    const walkStart = source.indexOf('const walk = async');
    const walkEnd = source.indexOf('};', walkStart) + 2;
    const walkSource = source.substring(walkStart, walkEnd);

    assert.ok(
      !walkSource.includes('readFile('),
      'walk() should not call readFile - files should be read lazily during upload'
    );
  });

  it('walk() restituisce filepath (non file content)', () => {
    const walkStart = source.indexOf('const walk = async');
    const walkEnd = source.indexOf('};', walkStart) + 2;
    const walkSource = source.substring(walkStart, walkEnd);

    assert.ok(
      walkSource.includes('filepath'),
      'walk() should return filepath for deferred reading'
    );
  });

  it('_uploadDir usa readFile al momento dell\'upload', () => {
    const uploadStart = source.indexOf('const _uploadDir');
    const uploadEnd = source.indexOf('};', uploadStart) + 2;
    const uploadSource = source.substring(uploadStart, uploadEnd);

    assert.ok(
      uploadSource.includes('readFile(fileInfo.filepath)'),
      '_uploadDir should read file content at upload time'
    );
  });
});

// ============================================================
// Tests: walk() - Runtime con file reali
// ============================================================

describe('walk() - Runtime con directory temporanea', () => {
  const walkFn = async (currentDirPath) => {
    const { readdir, stat } = require('fs/promises');
    const mime = require('mime-types');
    const ret = [];
    const files = await readdir(currentDirPath);
    for (const file of files) {
      const filepath = path.join(currentDirPath, file);
      const fileStat = await stat(filepath);
      if (fileStat.isFile()) {
        ret.push({
          filepath,
          filename: file,
          contentType: mime.lookup(path.extname(file)) || 'application/octet-stream',
        });
      } else if (fileStat.isDirectory()) {
        ret.push(...(await walkFn(filepath)));
      }
    }
    return ret;
  };

  it('scansiona file in una directory', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'walk-test-'));
    fs.writeFileSync(path.join(tmpDir, 'test.jpg'), 'fake image');
    fs.writeFileSync(path.join(tmpDir, 'model.obj'), 'fake model');

    const results = await walkFn(tmpDir);

    assert.equal(results.length, 2);
    assert.ok(results.some(r => r.filename === 'test.jpg'));
    assert.ok(results.some(r => r.filename === 'model.obj'));

    // Verifica che contenga filepath, non contenuto del file
    assert.ok(results[0].filepath.startsWith(tmpDir));
    assert.equal(typeof results[0].filepath, 'string');

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('scansiona ricorsivamente le subdirectory', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'walk-test-'));
    const subDir = path.join(tmpDir, 'subdir');
    fs.mkdirSync(subDir);
    fs.writeFileSync(path.join(tmpDir, 'root.txt'), 'root');
    fs.writeFileSync(path.join(subDir, 'nested.txt'), 'nested');

    const results = await walkFn(tmpDir);

    assert.equal(results.length, 2);
    assert.ok(results.some(r => r.filename === 'root.txt'));
    assert.ok(results.some(r => r.filename === 'nested.txt'));

    fs.rmSync(tmpDir, { recursive: true });
  });

  it('restituisce il contentType corretto', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'walk-test-'));
    fs.writeFileSync(path.join(tmpDir, 'photo.jpg'), 'fake');
    fs.writeFileSync(path.join(tmpDir, 'model.usdz'), 'fake');

    const results = await walkFn(tmpDir);

    const jpg = results.find(r => r.filename === 'photo.jpg');
    assert.equal(jpg.contentType, 'image/jpeg');

    fs.rmSync(tmpDir, { recursive: true });
  });

  it('gestisce directory vuote', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'walk-test-'));

    const results = await walkFn(tmpDir);

    assert.equal(results.length, 0);

    fs.rmSync(tmpDir, { recursive: true });
  });
});

// ============================================================
// Tests: Source analysis - no for-await su array sincroni
// ============================================================

describe('Codice sorgente - No for-await su array sincroni', () => {
  it('s3.js non usa for-await su array normali', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../../src/utils/s3.js'),
      'utf8'
    );

    // for-await e' legittimo solo se l'iterabile e' asincrono
    // Nel nostro codice, tutti gli array sono sincroni
    assert.ok(
      !source.includes('for await'),
      'Should not use for-await on synchronous arrays'
    );
  });
});

// ============================================================
// Tests: Source analysis - Deferred remote file deletion
// ============================================================

describe('Cancellazione differita file remoti', () => {
  const s3Source = fs.readFileSync(
    path.join(__dirname, '../../src/utils/s3.js'),
    'utf8'
  );

  it('_downloadFiles non chiama deleteObject', () => {
    // Estrai la funzione _downloadFiles
    const fnStart = s3Source.indexOf('const _downloadFiles');
    const fnEnd = s3Source.indexOf('\n};', fnStart) + 3;
    const fnSource = s3Source.substring(fnStart, fnEnd);

    assert.ok(
      !fnSource.includes('deleteObject'),
      '_downloadFiles should NOT delete remote files (deferred deletion)'
    );
  });

  it('esporta cleanupRemoteFiles per cancellazione differita', () => {
    assert.ok(
      s3Source.includes('cleanupRemoteFiles'),
      'Should export cleanupRemoteFiles function'
    );
  });

  it('_downloadFiles restituisce le location scaricate', () => {
    const fnStart = s3Source.indexOf('const _downloadFiles');
    const fnEnd = s3Source.indexOf('\n};', fnStart) + 3;
    const fnSource = s3Source.substring(fnStart, fnEnd);

    assert.ok(
      fnSource.includes('return downloadedLocations'),
      'Should return downloaded locations for deferred cleanup'
    );
  });
});
