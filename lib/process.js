// DEPRECATED - NOT USED

const { exec } = require('child_process')
const path = require('path')
const { supabase, BUCKET } = require('./supabaseClient')
// const queue = require('fastq')(worker, 1)
const fastq = require('fastq')
const { promises } = require('fs')
const { walk } = require('../src/utils')
const queue = fastq.promise(worker, 1)

const dir = __dirname
const libDir = path.join(dir, '..', 'src', 'lib')
// const libDir = `${dir}/src/lib`
// processor
const processor = async ({ imgDir, outDir, filename, detail = 'medium', order = 'unordered', feature = 'normal' }) => {
  console.log('processor')
  const _outDir = path.join(__dirname, '..', outDir)
  const _imgDir = path.join(__dirname, '..', imgDir)
  return new Promise((res, rej) => exec(
    `cd ${libDir} && ./HelloPhotogrammetry ${_imgDir} ${_outDir}${filename}.usdz -d ${detail} -o ${order} -f ${feature}`,
    error => {
      if (error) {
        rej(error)
        return
      }
      res('ok')
    }))
}
const convert = async ({ file_location }) => {
  const _path = path.join(__dirname, '..', file_location);
  console.log('convert')
  return new Promise((res, rej) => exec(
    `cd ${libDir} && ./usdconv ${_path}model.usdz`,
    error => {
      if (error) {
        console.log(error)
        res(error)
        return
      }
      res('ok')
    }))
}

const _uploadDir = async ({ file_location }) => {
  const _path = file_location;
  const files = await walk(_path)
  console.log('Uploading files:', files.length)
  const _files = await Promise.all(files)
  // _files.forEach(async ({ file, path }, i) => {
  for await (const { file, filename, contentType } of _files) {
    console.log('Uploading file: ' + filename)
    await supabase.storage
      .from(BUCKET)
      .upload(_path + filename, await file, {
        contentType
      })
  }
}
// main worker function
async function worker({ file_location, detail, ordering, feature, project_id, process_id }) {
  console.log('worker')
  try {
    // aggiornare lo stato del processo
    await supabase
      .from('Process')
      .update({ status: 'processing' })
      .eq('id', process_id)

    // process
    const _res = await processor({ imgDir: file_location + 'images/', outDir: file_location, filename: 'model', detail, order: ordering, feature })
    console.log(_res)
    // cancellare le foto dalla cartella locale
    await promises.rm(file_location + 'images/', { recursive: true })
    await promises.mkdir(`${file_location}model/`, { recursive: true })
    // convert
    const res = await convert({ file_location })
    console.log(res)
    // aggiornare lo stato del processo
    const _currentDate = new Date()
    await supabase
      .from('Process')
      .update({ status: 'done', finished_at: _currentDate, models_url: [file_location + 'models/' + 'model.usdz'] })
      .eq('id', process_id)

    await _uploadDir({ file_location })

  } catch (error) { console.log(error) }
}

const handleRealtime = async (payload) => {
  // 1 Get the new record
  console.log(payload)
  const { new: newRecord } = payload;
  // 2 Retrieve related data
  const { data: _dataProcess, error: _errorProcess } = await supabase
    .from('Process')
    .select('*')
    .eq('id', newRecord.process_id)
    .single()
  console.log(_dataProcess, _errorProcess)
  const { detail, ordering, feature } = _dataProcess
  const { data: _dataProject, error: _errorProject } = await supabase
    .from('Project')
    .select('*')
    .eq('id', newRecord.project_id)
    .single()
  console.log(_dataProject, _errorProject)
  const { file_location, files } = _dataProject
  // 3 Push in queue (fastq)
  queue.push({ file_location, detail, ordering, feature, files, project_id: newRecord.project_id, process_id: newRecord.process_id })

}

// SUBSCRIPTION
supabase
  .channel('postgresChangesChannel')
  .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'Queue',
    },
    handleRealtime
  )
  .subscribe((status, err) => {
    console.log('[process.js] QUEUE -->' + status, err)

    if (err) process.exit(1) // exit if error and restart with pm2
  })