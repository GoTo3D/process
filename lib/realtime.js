// DEPRECATED - NOT USED

const { promises } = require('fs')
const { supabase, BUCKET } = require('./supabaseClient');

const handleRealtime = async (payload) => {
  // 1 Get the new record
  console.log(payload)
  const { new: _newProcess } = payload;
  // 2 Retrieve image from the supabase bucket
  const { data: _dataProject, error: _errorProject } = await supabase
    .from('Project')
    .select('*')
    .eq('id', _newProcess.project_id)
    .single()
  console.log('project', _dataProject, _errorProject)
  // 3 Download file from the bucket
  const { file_location, files } = _dataProject

  try {
    // 4 Create folder (local)
    await promises.mkdir(`${file_location}images/`, { recursive: true })
    for (let i = 0; i < files.length; i++) {
      const { file_name } = files[i];
      const location = `${file_location}images/${file_name}`
      // 5. Download file from the bucket
      console.log('BUCKET', BUCKET, location)
      const { data: _dataFiles, error: _errorFiles } = await supabase.storage
        .from(BUCKET)
        .download(location)
      console.log('download', _dataFiles, _errorFiles)

      const blob = _dataFiles;
      const buffer = Buffer.from(await blob.arrayBuffer());
      // 5.1 Save file in the local folder
      await promises.writeFile(location, buffer);

      // 6. Delete file from the bucket
      await supabase.storage
        .from(BUCKET)
        .remove([location])
    }
  } catch (error) {
    console.log(error)
  }
  // 7 Push in queue (trigger)
  const { data: _dataQueue, error: _errorQueue } = await supabase
    .from('Queue')
    .insert({ project_id: _newProcess.project_id, process_id: _newProcess.id, status: 'Pending' })
  console.log('queue', _dataQueue, _errorQueue)

}

// SUBSCRIPTION
supabase
  .channel('postgresChangesChannel')
  .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'Process',
    },
    handleRealtime
  )
  .subscribe((status, err) => {
    console.log('[realtime.js] PROCESS--> ' + status, err)
    if (err) process.exit(1) // exit if error and restart with pm2
  })