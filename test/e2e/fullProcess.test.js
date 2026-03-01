/**
 * E2E Test: Full Processing Flow
 *
 * Testa l'intero flusso: creazione progetto -> upload immagini -> invio coda -> processamento
 *
 * PREREQUISITI:
 * 1. Il servizio processQueue deve essere in esecuzione (npm run dev)
 * 2. RabbitMQ deve essere accessibile
 * 3. Le immagini di esempio devono essere in /Volumes/T7/sample
 * 4. Le variabili d'ambiente devono essere configurate (.env)
 *
 * ESECUZIONE:
 *   node test/e2e/fullProcess.test.js
 */

const {
  createTestProject,
  deleteTestProject,
  getProjectStatus,
  uploadSampleImages,
  cleanupStorage,
  cleanupLocalFiles,
  waitForStatus,
  sendToQueue,
  verifyModelFiles,
} = require('../helpers/testUtils');

// Configurazione test
const TEST_CONFIG = {
  maxImages: 5,          // Numero di immagini da usare (meno = più veloce)
  detail: 'preview',     // Livello di dettaglio (preview è il più veloce)
  timeout: 15 * 60 * 1000, // Timeout 15 minuti
  cleanupOnSuccess: true,  // Pulisce i file dopo un test riuscito
  cleanupOnFailure: false, // Mantiene i file per debug in caso di fallimento
};

/**
 * Test principale
 */
async function runE2ETest() {
  let projectId = null;
  let testPassed = false;

  console.log('\n========================================');
  console.log('  E2E TEST: Full Processing Flow');
  console.log('========================================\n');

  try {
    // Step 1: Crea progetto nel database
    console.log('[Step 1/6] Creating test project in database...');
    const project = await createTestProject({
      detail: TEST_CONFIG.detail,
      order: 'unordered',
      feature: 'normal',
      files: [], // Verrà aggiornato dopo l'upload
    });
    projectId = project.id;
    console.log(`  -> Project created with ID: ${projectId}`);

    // Step 2: Upload immagini di esempio
    console.log(`\n[Step 2/6] Uploading ${TEST_CONFIG.maxImages} sample images...`);
    const uploadedFiles = await uploadSampleImages(projectId, TEST_CONFIG.maxImages);
    console.log(`  -> Uploaded ${uploadedFiles.length} files`);

    if (uploadedFiles.length === 0) {
      throw new Error('No files were uploaded. Check /Volumes/T7/sample directory');
    }

    // Step 3: Aggiorna il progetto con i file
    console.log('\n[Step 3/6] Updating project with file list...');
    const { supabase } = require('../../src/lib/supabaseClient');
    await supabase
      .from('project')
      .update({ files: uploadedFiles })
      .eq('id', projectId);
    console.log('  -> Project updated with files');

    // Step 4: Invia alla coda
    console.log('\n[Step 4/6] Sending project to processing queue...');
    await sendToQueue(projectId);
    console.log('  -> Message sent to queue');

    // Step 5: Attendi completamento
    console.log('\n[Step 5/6] Waiting for processing to complete...');
    console.log(`  (Timeout: ${TEST_CONFIG.timeout / 1000 / 60} minutes)`);

    const startTime = Date.now();
    const finalProject = await waitForStatus(
      projectId,
      'done',
      TEST_CONFIG.timeout,
      10000 // Poll ogni 10 secondi
    );
    const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(2);

    console.log(`  -> Processing completed in ${duration} minutes`);

    // Step 6: Verifica risultati
    console.log('\n[Step 6/6] Verifying results...');

    // Verifica stato database
    console.log('  Checking database status...');
    if (finalProject.status !== 'done') {
      throw new Error(`Unexpected status: ${finalProject.status}`);
    }
    console.log('  -> Database status: OK');

    // Verifica timestamps
    if (!finalProject.process_start || !finalProject.process_end) {
      throw new Error('Process timestamps not set');
    }
    console.log('  -> Timestamps: OK');

    // Verifica model_urls
    if (!finalProject.model_urls || finalProject.model_urls.length === 0) {
      console.warn('  -> Warning: model_urls is empty');
    } else {
      console.log(`  -> Model URLs: ${finalProject.model_urls.length} files`);
    }

    // Verifica file locali
    const modelCheck = await verifyModelFiles(projectId);
    console.log(`  -> Local files: ${modelCheck.files.length} files`);
    console.log(`     - USDZ: ${modelCheck.hasUsdz ? 'YES' : 'NO'}`);
    console.log(`     - OBJ: ${modelCheck.hasObj ? 'YES' : 'NO'}`);

    if (!modelCheck.hasUsdz) {
      throw new Error('USDZ file not generated');
    }

    testPassed = true;
    console.log('\n========================================');
    console.log('  TEST PASSED');
    console.log('========================================\n');

  } catch (error) {
    console.error('\n========================================');
    console.error('  TEST FAILED');
    console.error('========================================');
    console.error(`Error: ${error.message}`);

    if (projectId) {
      try {
        const status = await getProjectStatus(projectId);
        console.error(`\nProject status: ${status.status}`);
        if (status.status === 'error') {
          console.error('Project is in error state. Check logs for details.');
        }
      } catch (e) {
        // Ignora errori nel recupero stato
      }
    }

    console.error('\n');

  } finally {
    // Cleanup
    if (projectId) {
      const shouldCleanup = testPassed
        ? TEST_CONFIG.cleanupOnSuccess
        : TEST_CONFIG.cleanupOnFailure;

      if (shouldCleanup) {
        console.log('Cleaning up test resources...');
        await cleanupStorage(projectId);
        await cleanupLocalFiles(projectId);
        await deleteTestProject(projectId);
        console.log('Cleanup complete.');
      } else {
        console.log(`\nTest resources preserved for debugging:`);
        console.log(`  - Project ID: ${projectId}`);
        console.log(`  - Local files: /Volumes/T7/projects/${projectId}/`);
      }
    }
  }

  process.exit(testPassed ? 0 : 1);
}

// Esegui test
runE2ETest();
