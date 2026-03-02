/**
 * Benchmark Test: PhotoProcess Variants
 *
 * Esegue PhotoProcess con tutte le possibili combinazioni di parametri
 * per confrontare tempi di esecuzione e dimensioni/qualità dell'output.
 *
 * ESECUZIONE:
 *   node test/integration/benchmark.test.js
 *
 * OPZIONI:
 *   --images=<N>        Numero di immagini da usare (default: 5)
 *   --keep              Non eliminare i file dopo il test
 *   --group=<name>      Esegui solo un gruppo: detail, ordering, feature, masking, output, custom, combined
 *   --variant=<index>   Esegui solo la variante con indice specifico (0-based)
 *   --report=<path>     Salva il report JSON in un file (default: stdout)
 *   --timeout=<min>     Timeout per singola variante in minuti (default: 30)
 *
 * ESEMPI:
 *   node test/integration/benchmark.test.js --images=10
 *   node test/integration/benchmark.test.js --group=detail --keep
 *   node test/integration/benchmark.test.js --variant=0 --images=3
 *   node test/integration/benchmark.test.js --report=benchmark-results.json
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const SAMPLE_IMAGES_PATH = '/Volumes/T7/sample';
const PROJECTS_BASE = '/Volumes/T7/projects';
const LIB_DIR = path.join(__dirname, '../../src/lib');
const BIN = path.join(LIB_DIR, 'PhotoProcess');

// Parse CLI arguments
const args = process.argv.slice(2);
const keepFiles = args.includes('--keep');
const maxImages = parseInt(args.find(a => a.startsWith('--images='))?.split('=')[1] || '5');
const groupFilter = args.find(a => a.startsWith('--group='))?.split('=')[1] || null;
const variantFilter = args.find(a => a.startsWith('--variant='))?.split('=')[1];
const reportPath = args.find(a => a.startsWith('--report='))?.split('=')[1] || null;
const timeoutMin = parseInt(args.find(a => a.startsWith('--timeout='))?.split('=')[1] || '30');

// --------------------------------------------------------------------------
// Definizione varianti
// --------------------------------------------------------------------------

const VARIANTS = [
  // --- Gruppo: detail ---
  {
    name: 'detail-preview',
    group: 'detail',
    args: ['--detail', 'preview'],
    expectUsdz: true,
    expectObj: true,
  },
  {
    name: 'detail-reduced',
    group: 'detail',
    args: ['--detail', 'reduced'],
    expectUsdz: true,
    expectObj: true,
  },
  {
    name: 'detail-medium',
    group: 'detail',
    args: ['--detail', 'medium'],
    expectUsdz: true,
    expectObj: true,
  },
  {
    name: 'detail-full',
    group: 'detail',
    args: ['--detail', 'full'],
    expectUsdz: true,
    expectObj: true,
  },
  {
    name: 'detail-raw',
    group: 'detail',
    args: ['--detail', 'raw'],
    expectUsdz: true,
    expectObj: true,
  },

  // --- Gruppo: ordering ---
  {
    name: 'ordering-unordered',
    group: 'ordering',
    args: ['--detail', 'preview', '--ordering', 'unordered'],
    expectUsdz: true,
    expectObj: true,
  },
  {
    name: 'ordering-sequential',
    group: 'ordering',
    args: ['--detail', 'preview', '--ordering', 'sequential'],
    expectUsdz: true,
    expectObj: true,
  },

  // --- Gruppo: feature-sensitivity ---
  {
    name: 'feature-normal',
    group: 'feature',
    args: ['--detail', 'preview', '--feature-sensitivity', 'normal'],
    expectUsdz: true,
    expectObj: true,
  },
  {
    name: 'feature-high',
    group: 'feature',
    args: ['--detail', 'preview', '--feature-sensitivity', 'high'],
    expectUsdz: true,
    expectObj: true,
  },

  // --- Gruppo: object masking ---
  {
    name: 'masking-enabled',
    group: 'masking',
    args: ['--detail', 'preview'],
    expectUsdz: true,
    expectObj: true,
  },
  {
    name: 'masking-disabled',
    group: 'masking',
    args: ['--detail', 'preview', '--no-object-masking'],
    expectUsdz: true,
    expectObj: true,
  },

  // --- Gruppo: output format ---
  {
    name: 'output-both',
    group: 'output',
    args: ['--detail', 'preview'],
    expectUsdz: true,
    expectObj: true,
  },
  {
    name: 'output-usdz-only',
    group: 'output',
    args: ['--detail', 'preview', '--skip-obj'],
    expectUsdz: true,
    expectObj: false,
  },
  {
    name: 'output-obj-only',
    group: 'output',
    args: ['--detail', 'preview', '--skip-usdz'],
    expectUsdz: false,
    expectObj: true,
  },

  // --- Gruppo: custom detail ---
  {
    name: 'custom-low-poly-1k-png',
    group: 'custom',
    args: [
      '--detail', 'custom',
      '--max-polygons', '50000',
      '--texture-dimension', '1k',
      '--texture-format', 'png',
      '--texture-maps', 'diffuse,normal',
    ],
    expectUsdz: true,
    expectObj: true,
  },
  {
    name: 'custom-mid-poly-4k-jpeg',
    group: 'custom',
    args: [
      '--detail', 'custom',
      '--max-polygons', '200000',
      '--texture-dimension', '4k',
      '--texture-format', 'jpeg',
      '--texture-quality', '0.8',
      '--texture-maps', 'diffuse,normal,roughness',
    ],
    expectUsdz: true,
    expectObj: true,
  },
  {
    name: 'custom-high-poly-8k-all-maps',
    group: 'custom',
    args: [
      '--detail', 'custom',
      '--max-polygons', '500000',
      '--texture-dimension', '8k',
      '--texture-format', 'png',
      '--texture-maps', 'all',
    ],
    expectUsdz: true,
    expectObj: true,
  },
  {
    name: 'custom-max-poly-16k',
    group: 'custom',
    args: [
      '--detail', 'custom',
      '--max-polygons', '1000000',
      '--texture-dimension', '16k',
      '--texture-format', 'png',
      '--texture-maps', 'all',
    ],
    expectUsdz: true,
    expectObj: true,
  },

  // --- Gruppo: combinazioni incrociate ---
  {
    name: 'medium-high-sensitivity',
    group: 'combined',
    args: ['--detail', 'medium', '--feature-sensitivity', 'high'],
    expectUsdz: true,
    expectObj: true,
  },
  {
    name: 'full-high-sensitivity',
    group: 'combined',
    args: ['--detail', 'full', '--feature-sensitivity', 'high'],
    expectUsdz: true,
    expectObj: true,
  },
  {
    name: 'reduced-sequential',
    group: 'combined',
    args: ['--detail', 'reduced', '--ordering', 'sequential'],
    expectUsdz: true,
    expectObj: true,
  },
  {
    name: 'medium-sequential-high',
    group: 'combined',
    args: ['--detail', 'medium', '--ordering', 'sequential', '--feature-sensitivity', 'high'],
    expectUsdz: true,
    expectObj: true,
  },
  {
    name: 'full-no-masking',
    group: 'combined',
    args: ['--detail', 'full', '--no-object-masking'],
    expectUsdz: true,
    expectObj: true,
  },
];

// --------------------------------------------------------------------------
// Funzioni di utilità
// --------------------------------------------------------------------------

function filterVariants() {
  let filtered = VARIANTS;

  if (groupFilter) {
    filtered = filtered.filter(v => v.group === groupFilter);
    if (filtered.length === 0) {
      const groups = [...new Set(VARIANTS.map(v => v.group))];
      console.error(`Gruppo "${groupFilter}" non trovato. Gruppi disponibili: ${groups.join(', ')}`);
      process.exit(1);
    }
  }

  if (variantFilter !== undefined) {
    const idx = parseInt(variantFilter);
    if (idx >= 0 && idx < filtered.length) {
      filtered = [filtered[idx]];
    } else {
      console.error(`Indice variante ${idx} fuori range (0-${filtered.length - 1})`);
      process.exit(1);
    }
  }

  return filtered;
}

async function copyImages(destDir) {
  await fs.promises.mkdir(destDir, { recursive: true });

  const files = fs.readdirSync(SAMPLE_IMAGES_PATH)
    .filter(f => /\.(heic|jpg|jpeg|png)$/i.test(f))
    .slice(0, maxImages);

  for (const file of files) {
    await fs.promises.copyFile(
      path.join(SAMPLE_IMAGES_PATH, file),
      path.join(destDir, file)
    );
  }

  return files.length;
}

async function getFileStats(dir) {
  const result = { files: [], totalSize: 0 };

  try {
    const entries = await fs.promises.readdir(dir);
    for (const entry of entries) {
      const fullPath = path.join(dir, entry);
      const stat = await fs.promises.stat(fullPath);
      if (stat.isFile()) {
        result.files.push({
          name: entry,
          size: stat.size,
          sizeMB: +(stat.size / 1024 / 1024).toFixed(2),
        });
        result.totalSize += stat.size;
      }
    }
  } catch {
    // directory doesn't exist
  }

  result.totalSizeMB = +(result.totalSize / 1024 / 1024).toFixed(2);
  return result;
}

function runPhotoProcess(imgDir, outDir, variantArgs, timeoutMs) {
  return new Promise((resolve, reject) => {
    const fullArgs = [imgDir, outDir, ...variantArgs];
    const child = spawn(BIN, fullArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const progressEvents = [];
    let lastProgress = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      const lines = data.toString().trim().split('\n');
      for (const line of lines) {
        try {
          const event = JSON.parse(line);
          progressEvents.push({ ...event, timestamp: Date.now() });
          if (event.type === 'progress') {
            const pct = (event.fraction * 100).toFixed(1);
            lastProgress = `${pct}% ${event.stage || ''}`;
            process.stdout.write(`\r    Progress: ${lastProgress}   `);
          }
        } catch {
          // non-JSON output
        }
      }
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Timeout (${timeoutMs / 60000} min)`));
    }, timeoutMs);

    child.on('close', (code) => {
      clearTimeout(timer);
      if (lastProgress) process.stdout.write('\r' + ' '.repeat(60) + '\r');
      resolve({ code, progressEvents, stderr });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const min = Math.floor(sec / 60);
  const remainSec = (sec % 60).toFixed(0);
  return `${min}m ${remainSec}s`;
}

function printSummaryTable(results) {
  console.log('\n' + '='.repeat(110));
  console.log('  BENCHMARK SUMMARY');
  console.log('='.repeat(110));

  const cols = {
    name: 30,
    status: 8,
    duration: 12,
    usdz: 12,
    obj: 12,
    total: 12,
    files: 18,
  };

  const header =
    'Variante'.padEnd(cols.name) +
    'Status'.padEnd(cols.status) +
    'Durata'.padEnd(cols.duration) +
    'USDZ (MB)'.padEnd(cols.usdz) +
    'OBJ (MB)'.padEnd(cols.obj) +
    'Totale (MB)'.padEnd(cols.total) +
    'Files';

  console.log(header);
  console.log('-'.repeat(110));

  for (const r of results) {
    const usdzFile = r.outputFiles?.files.find(f => f.name.endsWith('.usdz'));
    const objFile = r.outputFiles?.files.find(f => f.name.endsWith('.obj'));

    const line =
      r.name.padEnd(cols.name) +
      (r.success ? 'OK' : 'FAIL').padEnd(cols.status) +
      formatDuration(r.durationMs).padEnd(cols.duration) +
      (usdzFile ? String(usdzFile.sizeMB) : '-').padEnd(cols.usdz) +
      (objFile ? String(objFile.sizeMB) : '-').padEnd(cols.obj) +
      (r.outputFiles ? String(r.outputFiles.totalSizeMB) : '-').padEnd(cols.total) +
      (r.outputFiles ? r.outputFiles.files.map(f => f.name).join(', ') : r.error || '');

    console.log(line);
  }

  console.log('-'.repeat(110));

  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  const totalTime = results.reduce((acc, r) => acc + r.durationMs, 0);

  console.log(`\nRisultati: ${successful.length} OK, ${failed.length} FAIL su ${results.length} varianti`);
  console.log(`Tempo totale: ${formatDuration(totalTime)}`);
  console.log(`Immagini usate: ${maxImages}`);

  if (successful.length > 0) {
    const durations = successful.map(r => r.durationMs).sort((a, b) => a - b);
    console.log(`\nDurata min: ${formatDuration(durations[0])} (${successful.find(r => r.durationMs === durations[0]).name})`);
    console.log(`Durata max: ${formatDuration(durations[durations.length - 1])} (${successful.find(r => r.durationMs === durations[durations.length - 1]).name})`);
    console.log(`Durata media: ${formatDuration(Math.round(durations.reduce((a, b) => a + b, 0) / durations.length))}`);

    const sizes = successful
      .filter(r => r.outputFiles)
      .map(r => ({ name: r.name, size: r.outputFiles.totalSizeMB }))
      .sort((a, b) => a.size - b.size);

    if (sizes.length > 0) {
      console.log(`\nOutput min: ${sizes[0].size} MB (${sizes[0].name})`);
      console.log(`Output max: ${sizes[sizes.length - 1].size} MB (${sizes[sizes.length - 1].name})`);
    }
  }

  if (failed.length > 0) {
    console.log('\nVarianti fallite:');
    for (const r of failed) {
      console.log(`  - ${r.name}: ${r.error}`);
    }
  }

  console.log('');
}

// --------------------------------------------------------------------------
// Main
// --------------------------------------------------------------------------

async function main() {
  const variants = filterVariants();

  console.log('\n' + '='.repeat(70));
  console.log('  PhotoProcess Benchmark');
  console.log('='.repeat(70));
  console.log(`  Varianti:       ${variants.length}`);
  console.log(`  Immagini:       ${maxImages}`);
  console.log(`  Timeout:        ${timeoutMin} min per variante`);
  console.log(`  Keep files:     ${keepFiles}`);
  if (groupFilter) console.log(`  Gruppo:         ${groupFilter}`);
  console.log(`  Binary:         ${BIN}`);
  console.log(`  Sample images:  ${SAMPLE_IMAGES_PATH}`);
  console.log('');

  // Verifica prerequisiti
  try {
    await fs.promises.access(BIN, fs.constants.X_OK);
  } catch {
    console.error(`Binary non trovato o non eseguibile: ${BIN}`);
    process.exit(1);
  }

  try {
    const sampleFiles = fs.readdirSync(SAMPLE_IMAGES_PATH)
      .filter(f => /\.(heic|jpg|jpeg|png)$/i.test(f));
    if (sampleFiles.length === 0) {
      console.error(`Nessuna immagine trovata in: ${SAMPLE_IMAGES_PATH}`);
      process.exit(1);
    }
    console.log(`  Immagini disponibili: ${sampleFiles.length}`);
  } catch {
    console.error(`Directory sample non accessibile: ${SAMPLE_IMAGES_PATH}`);
    process.exit(1);
  }

  console.log('\n  Varianti da eseguire:');
  variants.forEach((v, i) => {
    console.log(`    [${i}] ${v.name}  ->  ${v.args.join(' ')}`);
  });
  console.log('');

  const results = [];
  const benchmarkStart = Date.now();

  for (let i = 0; i < variants.length; i++) {
    const variant = variants[i];
    const projectId = `bench_${Date.now()}_${i}`;
    const imgDir = path.join(PROJECTS_BASE, projectId, 'images');
    const outDir = path.join(PROJECTS_BASE, projectId, 'model');

    console.log(`\n[${i + 1}/${variants.length}] ${variant.name}`);
    console.log(`  Args: ${variant.args.join(' ')}`);

    const result = {
      name: variant.name,
      group: variant.group,
      args: variant.args,
      projectId,
      images: maxImages,
      success: false,
      durationMs: 0,
      outputFiles: null,
      error: null,
      exitCode: null,
      progressEvents: 0,
    };

    try {
      // Copia immagini
      const copied = await copyImages(imgDir);
      await fs.promises.mkdir(outDir, { recursive: true });
      console.log(`  Immagini copiate: ${copied}`);

      // Esegui PhotoProcess
      console.log('  Elaborazione in corso...');
      const startTime = Date.now();
      const { code, progressEvents, stderr } = await runPhotoProcess(
        imgDir, outDir, variant.args, timeoutMin * 60 * 1000
      );
      result.durationMs = Date.now() - startTime;
      result.exitCode = code;
      result.progressEvents = progressEvents.length;

      if (code !== 0) {
        result.error = `Exit code ${code}` + (stderr ? `: ${stderr.slice(0, 200)}` : '');
        console.log(`  FALLITO (exit code ${code}) in ${formatDuration(result.durationMs)}`);
        if (stderr) console.log(`  stderr: ${stderr.slice(0, 300)}`);
      } else {
        // Verifica output
        const outputStats = await getFileStats(outDir);
        result.outputFiles = outputStats;

        const hasUsdz = outputStats.files.some(f => f.name.endsWith('.usdz'));
        const hasObj = outputStats.files.some(f => f.name.endsWith('.obj'));

        if (variant.expectUsdz && !hasUsdz) {
          result.error = 'USDZ atteso ma non generato';
        } else if (variant.expectObj && !hasObj) {
          result.error = 'OBJ atteso ma non generato';
        } else {
          result.success = true;
        }

        console.log(`  Completato in ${formatDuration(result.durationMs)}`);
        console.log(`  Output: ${outputStats.files.map(f => `${f.name} (${f.sizeMB} MB)`).join(', ')}`);
        console.log(`  Totale output: ${outputStats.totalSizeMB} MB`);
      }
    } catch (err) {
      result.error = err.message;
      console.log(`  ERRORE: ${err.message}`);
    } finally {
      // Cleanup
      if (!keepFiles) {
        const projectDir = path.join(PROJECTS_BASE, projectId);
        try {
          await fs.promises.rm(projectDir, { recursive: true, force: true });
        } catch {
          // ignore
        }
      }
    }

    results.push(result);
  }

  const totalDuration = Date.now() - benchmarkStart;

  // Stampa tabella riassuntiva
  printSummaryTable(results);
  console.log(`Benchmark completato in ${formatDuration(totalDuration)}\n`);

  // Salva report JSON
  const report = {
    timestamp: new Date().toISOString(),
    config: { maxImages, timeoutMin, keepFiles, groupFilter },
    totalDurationMs: totalDuration,
    results,
  };

  if (reportPath) {
    await fs.promises.writeFile(reportPath, JSON.stringify(report, null, 2));
    console.log(`Report salvato in: ${reportPath}`);
  } else {
    console.log('(usa --report=<path> per salvare il report JSON)');
  }

  const allPassed = results.every(r => r.success);
  process.exit(allPassed ? 0 : 1);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
