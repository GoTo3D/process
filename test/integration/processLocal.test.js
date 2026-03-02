/**
 * Integration Test: Local Process Only (senza database)
 *
 * Testa direttamente ProcessManager usando file locali
 * Non richiede creazione di record nel database
 *
 * ESECUZIONE:
 *   node test/integration/processLocal.test.js
 *
 * OPZIONI:
 *   --keep        Non eliminare i file dopo il test
 *   --images=<N>  Numero di immagini da usare (default: 5)
 */

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

const SAMPLE_IMAGES_PATH = '/Volumes/T7/sample';
const TEST_PROJECT_ID = 'test_' + Date.now();

// Parse command line arguments
const args = process.argv.slice(2);
const keepFiles = args.includes('--keep');
const maxImages = parseInt(args.find(a => a.startsWith('--images='))?.split('=')[1] || '5');

async function runLocalTest() {
  const imgDir = `/Volumes/T7/projects/${TEST_PROJECT_ID}/images/`;
  const outDir = `/Volumes/T7/projects/${TEST_PROJECT_ID}/model/`;
  let testPassed = false;

  console.log('\n========================================');
  console.log('  Integration Test: Local ProcessManager');
  console.log('========================================\n');

  console.log('Configuration:');
  console.log(`  - Project ID: ${TEST_PROJECT_ID}`);
  console.log(`  - Max images: ${maxImages}`);
  console.log(`  - Keep files: ${keepFiles}`);
  console.log(`  - Image dir: ${imgDir}`);
  console.log(`  - Output dir: ${outDir}`);
  console.log('');

  try {
    // Step 1: Copia le immagini di esempio
    console.log('[Step 1/4] Copying sample images...');
    await fs.promises.mkdir(imgDir, { recursive: true });

    const sampleFiles = fs.readdirSync(SAMPLE_IMAGES_PATH)
      .filter(f => f.endsWith('.HEIC') || f.endsWith('.jpg') || f.endsWith('.png'))
      .slice(0, maxImages);

    for (const file of sampleFiles) {
      const src = path.join(SAMPLE_IMAGES_PATH, file);
      const dest = path.join(imgDir, file);
      await fs.promises.copyFile(src, dest);
      console.log(`  -> Copied: ${file}`);
    }

    console.log(`  -> Total: ${sampleFiles.length} images`);

    // Step 2: Crea output directory
    console.log('\n[Step 2/4] Creating output directory...');
    await fs.promises.mkdir(outDir, { recursive: true });
    console.log('  -> Output directory ready');

    // Step 3: Esegui PhotoProcess
    console.log('\n[Step 3/4] Running PhotoProcess...');
    console.log('  This may take several minutes...\n');

    const { spawn } = require('child_process');
    const libDir = path.join(__dirname, '../../src/lib');

    const bin = path.join(libDir, 'PhotoProcess');
    const processArgs = [imgDir, outDir, '--detail', 'preview', '--ordering', 'unordered', '--feature-sensitivity', 'normal'];
    console.log(`  Command: ${bin} ${processArgs.join(' ')}\n`);

    const startTime = Date.now();

    await new Promise((resolve, reject) => {
      const childProcess = spawn(bin, processArgs, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      childProcess.stdout.on('data', (data) => {
        const lines = data.toString().trim().split('\n');
        for (const line of lines) {
          try {
            const event = JSON.parse(line);
            if (event.type === 'progress') {
              const pct = (event.fraction * 100).toFixed(1);
              console.log(`  [${event.request}] ${pct}% ${event.stage || ''}`);
            } else {
              console.log(`  [${event.type}] ${JSON.stringify(event)}`);
            }
          } catch {
            console.log(`  ${line}`);
          }
        }
      });

      childProcess.stderr.on('data', (data) => {
        console.error(`  [stderr] ${data.toString().trim()}`);
      });

      childProcess.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`PhotoProcess exited with code ${code}`));
          return;
        }
        resolve();
      });

      childProcess.on('error', reject);
    });

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`  -> Processing completed in ${duration} seconds`);

    // Step 4: Verifica risultati
    console.log('\n[Step 4/4] Verifying results...');

    const outputFiles = await fs.promises.readdir(outDir);
    console.log(`  - Output files: ${outputFiles.join(', ') || 'none'}`);

    const hasUsdz = outputFiles.some(f => f.endsWith('.usdz'));
    console.log(`  - Has USDZ: ${hasUsdz}`);

    if (hasUsdz) {
      const usdzPath = path.join(outDir, 'model.usdz');
      const stats = await fs.promises.stat(usdzPath);
      console.log(`  - USDZ size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
    }

    // Verifica file OBJ (generati direttamente da PhotoProcess)
    if (hasUsdz) {
      const finalFiles = await fs.promises.readdir(outDir);
      const hasObj = finalFiles.some(f => f.endsWith('.obj'));
      console.log(`  - Has OBJ: ${hasObj}`);
      console.log(`  - Final files: ${finalFiles.join(', ')}`);
    }

    if (hasUsdz) {
      testPassed = true;
      console.log('\n========================================');
      console.log('  TEST PASSED');
      console.log('========================================\n');
    } else {
      throw new Error('USDZ file not generated');
    }

  } catch (error) {
    console.error('\n========================================');
    console.error('  TEST FAILED');
    console.error('========================================');
    console.error(`Error: ${error.message}`);
    console.error(error.stack);
    console.error('\n');

  } finally {
    // Cleanup
    if (!keepFiles) {
      const projectDir = `/Volumes/T7/projects/${TEST_PROJECT_ID}`;
      try {
        await fs.promises.rm(projectDir, { recursive: true, force: true });
        console.log('Cleaned up test files.');
      } catch (e) {
        // Ignore
      }
    } else {
      console.log(`\nFiles preserved (--keep flag):`);
      console.log(`  - Project dir: /Volumes/T7/projects/${TEST_PROJECT_ID}/`);
    }
  }

  process.exit(testPassed ? 0 : 1);
}

runLocalTest();
