/**
 * Integration Test: Process Only (senza coda)
 *
 * Testa direttamente ProcessManager senza passare dalla coda AMQP
 * Utile per debug e test più rapidi
 *
 * ESECUZIONE:
 *   node test/integration/processOnly.test.js
 *
 * OPZIONI:
 *   --keep        Non eliminare i file dopo il test
 *   --local       Usa file locali invece di Supabase storage (consigliato)
 *   --id=<N>      Usa un progetto esistente invece di crearne uno nuovo
 *   --images=<N>  Numero di immagini da usare (default: 3)
 */

const {
  createTestProject,
  deleteTestProject,
  getProjectStatus,
  uploadSampleImages,
  copyLocalSampleImages,
  cleanupStorage,
  cleanupLocalFiles,
  verifyModelFiles,
} = require('../helpers/testUtils');

const ProcessManager = require('../../src/ProcessManager');

// Parse command line arguments
const args = process.argv.slice(2);
const keepFiles = args.includes('--keep');
const useLocalFiles = args.includes('--local');
const existingId = args.find(a => a.startsWith('--id='))?.split('=')[1];
const maxImages = parseInt(args.find(a => a.startsWith('--images='))?.split('=')[1] || '3');

async function runIntegrationTest() {
  let projectId = existingId ? parseInt(existingId) : null;
  let createdNew = false;
  let testPassed = false;

  console.log('\n========================================');
  console.log('  Integration Test: ProcessManager');
  console.log('========================================\n');

  console.log('Configuration:');
  console.log(`  - Max images: ${maxImages}`);
  console.log(`  - Keep files: ${keepFiles}`);
  console.log(`  - Use local files: ${useLocalFiles}`);
  if (existingId) {
    console.log(`  - Using existing project: ${existingId}`);
  }
  console.log('');

  try {
    // Step 1: Prepara progetto
    if (!projectId) {
      console.log('[Step 1/5] Creating test project...');
      const project = await createTestProject({
        detail: 'preview',
        order: 'unordered',
        feature: 'normal',
        files: [],
      });
      projectId = project.id;
      createdNew = true;
      console.log(`  -> Created project ID: ${projectId}`);

      let filesToProcess = [];

      if (useLocalFiles) {
        // Copia file localmente (bypassa Supabase storage)
        console.log(`\n[Step 2/5] Copying ${maxImages} sample images locally...`);
        filesToProcess = await copyLocalSampleImages(projectId, maxImages);
        console.log(`  -> Copied ${filesToProcess.length} files locally`);
      } else {
        // Upload immagini su Supabase storage
        console.log(`\n[Step 2/5] Uploading ${maxImages} sample images to storage...`);
        filesToProcess = await uploadSampleImages(projectId, maxImages);
        console.log(`  -> Uploaded ${filesToProcess.length} files to storage`);
      }

      // Aggiorna files nel progetto
      const { supabase } = require('../../src/lib/supabaseClient');
      await supabase
        .from('project')
        .update({ files: filesToProcess })
        .eq('id', projectId);

    } else {
      console.log('[Step 1/5] Using existing project...');
      console.log(`[Step 2/5] Skipping upload (using existing files)...`);
    }

    // Step 3: Crea ProcessManager
    console.log('\n[Step 3/5] Creating ProcessManager...');
    const pm = await ProcessManager.create(projectId);
    console.log(`  -> ProcessManager created for project ${projectId}`);
    console.log(`  -> Files to process: ${pm.project.files?.length || 0}`);
    console.log(`  -> Detail: ${pm.project.detail}`);
    console.log(`  -> Is Telegram: ${pm.isTelegram}`);

    // Step 4: Esegui processamento
    console.log('\n[Step 4/5] Starting processing...');
    console.log('  This may take several minutes...\n');

    const startTime = Date.now();

    await pm.process();

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n  -> Processing completed in ${duration} seconds`);

    // Step 5: Verifica risultati
    console.log('\n[Step 5/5] Verifying results...');

    // Stato database
    const finalStatus = await getProjectStatus(projectId);
    console.log(`  - Database status: ${finalStatus.status}`);
    console.log(`  - Process start: ${finalStatus.process_start}`);
    console.log(`  - Process end: ${finalStatus.process_end}`);

    // File modello
    const modelCheck = await verifyModelFiles(projectId);
    console.log(`  - Model files: ${modelCheck.files.join(', ') || 'none'}`);
    console.log(`  - Has USDZ: ${modelCheck.hasUsdz}`);
    console.log(`  - Has OBJ: ${modelCheck.hasObj}`);

    if (finalStatus.status === 'done' && modelCheck.hasUsdz) {
      testPassed = true;
      console.log('\n========================================');
      console.log('  TEST PASSED');
      console.log('========================================\n');
    } else {
      throw new Error('Processing completed but validation failed');
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
    if (projectId && !keepFiles) {
      const shouldCleanup = testPassed || !createdNew;

      if (shouldCleanup && createdNew) {
        console.log('Cleaning up...');
        await cleanupStorage(projectId);
        await cleanupLocalFiles(projectId);
        await deleteTestProject(projectId);
        console.log('Cleanup complete.');
      } else if (!shouldCleanup) {
        console.log(`\nTest resources preserved:`);
        console.log(`  - Project ID: ${projectId}`);
        console.log(`  - Local files: /Volumes/T7/projects/${projectId}/`);
      }
    } else if (keepFiles) {
      console.log(`\nFiles preserved (--keep flag):`);
      console.log(`  - Project ID: ${projectId}`);
      console.log(`  - Local files: /Volumes/T7/projects/${projectId}/`);
    }
  }

  process.exit(testPassed ? 0 : 1);
}

runIntegrationTest();
