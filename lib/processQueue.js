const { exec } = require('child_process')
const path = require('path')
const { supabase, BUCKET } = require('./supabaseClient')
const fs = require('fs')
const { walk } = require('../src/utils')
// const fastq = require('fastq')
// const queue = fastq.promise(worker, 1)
const amqp = require('amqplib/callback_api')
const dotenv = require('dotenv')
const { request } = require('undici')
const { mkdir } = require('fs/promises')
const { Telegraf } = require('telegraf')
dotenv.config()

const dir = __dirname
const libDir = path.join(dir, '..', 'src', 'lib')
/* Main - PROCESSOR */
const processor = async ({ imgDir, outDir, filename, detail = 'medium', order = 'unordered', feature = 'normal' }) => {
  console.log('processor')
  const _outDir = path.join(__dirname, '..', outDir)
  const _imgDir = path.join(__dirname, '..', imgDir)
  console.log(`cd ${libDir} && ./HelloPhotogrammetry ${_imgDir} ${_outDir}${filename}.usdz -d ${detail} -o ${order} -f ${feature}`)
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
/* Main - CONVERT */
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
/* Private - download files from supabase */
const _downloadFromSupabase = async (file_location, files) => {
  await fs.promises.mkdir(`${file_location}images/`, { recursive: true })
  for (let i = 0; i < files.length; i++) {
    const file_name  = files[i];
    const location = `${file_location}images/${file_name}`

    console.log('BUCKET', BUCKET, location)
    const { data: dataFiles, error: errorFiles } = await supabase.storage
      .from(BUCKET)
      .download(location)

    console.log('download', dataFiles, errorFiles)

    const blob = dataFiles;
    const buffer = Buffer.from(await blob.arrayBuffer());

    await fs.promises.writeFile(location, buffer);

    await supabase.storage
      .from(BUCKET)
      .remove([location])
  }
}
/* Private - download files from telegram */
const _downloadFromTelegram = async (id, imgs) => {
  const promises = imgs.map((img) => request(img));
  const responses = await Promise.all(promises);

  const dir = `test/${id}/images`;

  try { await mkdir(dir, { recursive: true }); }
  catch (e) { console.error(e) }

  for (let i = 0; i < responses.length; i++) {
    const response = responses[i];
    const filename = imgs[i].split('/').pop();
    const file = fs.createWriteStream(`${dir}/${filename}`);
    await response.body.pipe(file);
    console.log('Downloaded', filename)
  };

  return responses;
}
/* Private - upload files to supabase */
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

/* Main - WORKER */
async function worker({ dataProject }) {
  return new Promise(async (res, rej) => {
    console.log('worker')
    const { detail, ordering, feature, project_id, id: process_id } = dataProject
    let { files, user_id, telegram_user } = dataProject
    let isTelegram = false

    try {
      // download files from supabase
      if(!files || files.length === 0) throw new Error('No files to process')
      if(isTelegram) await _downloadFromTelegram(project_id, files)
      else await _downloadFromSupabase(project_id, files)

      // process
      await processor({ imgDir: project_id + 'images/', outDir: project_id, filename: 'model', detail, order: ordering, feature })

      // cancellare le foto dalla cartella locale
      await fs.promises.rm(project_id + 'images/', { recursive: true })
      await fs.promises.mkdir(`${project_id}model/`, { recursive: true })

      // convert
      await convert({ project_id })
      // upload files to s3
      await _uploadDir({ project_id })

      if(isTelegram){
        const {data, error} = await supabase.from('telegram_user').select('user_id').eq('id', telegram_user).single()
        if(error) throw error
        const bot = new Telegraf(process.env.BOT_TOKEN);
        bot.telegram.sendMessage(data.user_id, `Processing done for process ${process_id}`);
        bot.telegram.sendMessage(data.user_id, `You can download the model from this link: ${process.env.SUPABASE_URL}/viewer/${process_id}`)
        const source = path.join(__dirname, '..', project_id, 'model.usdz');
        await bot.telegram.sendDocument(data.user_id, { source: source });
      }

    } catch (error) { console.log(error); rej(error) }
    res('ok')
  });
}

const handler = async (id) => {
  try {
    const { data: project, error: errorProject } = await supabase
      .from('Project')
      .select('*')
      .eq('id', id)
      .single()
    if (errorProject) throw errorProject
    // aggiornare lo stato del processo e la data di inizio
    await supabase.from('project').update({ 
      status: 'processing', 
      started_at: new Date()
    }).eq('id', project.id)

    // MAIN WORKER
    await worker({ dataProject })

    // aggiornare lo stato del processo e la data di fine
    const {data, error} = await supabase.from('project').update({
      status: 'done',
      finished_at: new Date(),
      models_url: [id + 'models/' + 'model.usdz']
    }).eq('id', id);
    console.log(data, error)
  } catch (error) {
    console.log(error)
  }
}

// AMQP
amqp.connect(process.env.QUEUE_CONNECTION_STRING, function (error0, connection) {
  if (error0) throw error0
  connection.createChannel(function (error1, channel) {
    if (error1) throw error1

    var queue = 'processing'
    channel.assertQueue(queue, { durable: false })

    console.log(" [*] Waiting for messages in %s. To exit press CTRL+C", queue)

    const consumeMessage = function () {
      channel.get(queue, {}, async function (err, msg) {
        if (err) {
          console.log(err)
        } else {
          if (msg) {
            console.log(" [x] Received %s", msg.content.toString())
            handler(msg.content.toString())
              .then(() => {
                console.log("[x] Done", msg.content.toString())
                channel.ack(msg)
                consumeMessage()
              })
          } else {
            console.log("No message in queue")
            // if the queue is empty check every 5 seconds
            // una sorta di polling ma veramente losca...
            setTimeout(function () {
              consumeMessage()
            }, 5000)
          }
        }
      })
    }

    consumeMessage()
  })
});