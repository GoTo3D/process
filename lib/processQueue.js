const fs = require("fs");
const { exec } = require("child_process");
const path = require("path");
const { supabase } = require("./supabaseClient");
const { walk } = require("../src/utils");
const fastq = require("fastq");
const amqp = require("amqplib/callback_api");
const dotenv = require("dotenv");
const { request } = require("undici");
const { Telegraf } = require("telegraf");
const { getObject, deleteObject, putObject } = require("./s3Api");

dotenv.config();
const BUCKET = process.env.BUCKET;
const dir = __dirname;
const libDir = path.join(dir, "..", "src", "lib");

/* Main - PROCESSOR */
const processor = async ({
  id,
  imgDir,
  outDir,
  filename,
  detail = "reduced",
  order = "sequential",
  feature = "normal",
  isTelegram = false,
}) => {
  console.log("processor", id);

  try {
    // aggiornare lo stato del processo e la data di inizio
    await supabase
      .from("project")
      .update({
        status: "processing",
        process_start: new Date(),
      })
      .eq("id", parseInt(id));

    const _outDir = path.join(__dirname, "..", outDir);
    const _imgDir = path.join(__dirname, "..", imgDir);

    console.log(
      `cd ${libDir} && ./HelloPhotogrammetry ${_imgDir} ${_outDir}${filename}.usdz -d ${detail} -o ${order} -f ${feature}`
    );
    await new Promise((res, rej) =>
      exec(
        `cd ${libDir} && ./HelloPhotogrammetry ${_imgDir} ${_outDir}${filename}.usdz -d ${detail} -o ${order} -f ${feature}`,
        (error) => {
          if (error) {
            rej(error);
            return;
          }
          fs.promises
            .access(`${_outDir}${filename}.usdz`)
            .then(() => res("ok"))
            .catch(() => rej("File not found"));
        }
      )
    );

    // cancellare le foto dalla cartella locale
    await fs.promises.rm(imgDir, { recursive: true });

    // convert
    await convert(`${outDir}`);

    // upload files to s3
    const model_urls = await _uploadDir({
      file_location: `${outDir}`,
      bucket_location: `${id}`,
    });

    if (isTelegram) {
      const { data, error } = await supabase
        .from("telegram_user")
        .select("user_id")
        .eq("id", telegram_user)
        .single();
      if (error) throw error;
      const bot = new Telegraf(process.env.BOT_TOKEN);
      bot.telegram.sendMessage(
        data.user_id,
        `Processing done for process ${process_id}`
      );
      bot.telegram.sendMessage(
        data.user_id,
        `You can download the model from this link: ${process.env.SUPABASE_URL}/viewer/${process_id}`
      );
      const source = path.join(__dirname, "..", id, "model.usdz");
      await bot.telegram.sendDocument(data.user_id, { source: source });
    }

    // aggiornare lo stato del processo e la data di fine
    const { data, error } = await supabase
      .from("project")
      .update({
        status: "done",
        process_end: new Date(),
        model_urls: model_urls,
      })
      .eq("id", parseInt(id));
    if (error) throw error;
    console.log(`Processing ${id} done`);
  } catch (error) {
    console.log(error);
    await supabase
      .from("project")
      .update({
        status: "error",
        process_end: new Date(),
      })
      .eq("id", parseInt(id));
  }
};

const queue = fastq.promise(processor, 1);

/* Main - CONVERT */
const convert = async (file_location) => {
  const _modelDir = path.join(__dirname, "..", file_location);

  return new Promise((res, rej) =>
    exec(`cd ${libDir} && ./usdconv ${_modelDir}model.usdz`, (error) => {
      if (error) {
        console.log(error);
        res(error);
        return;
      }
      res("ok");
    })
  );
};
/* Private - download files from supabase */
const _downloadFiles = async (id, files) => {
  try {
    const locationPath = `projects/${id}`;
    const localImageLocation = `${locationPath}/images/`;
    // creo la cartella projects/id/images se non esiste
    await fs.promises.mkdir(localImageLocation, { recursive: true });

    // ciclo tutti i file per scaricarli
    for (let i = 0; i < files.length; i++) {
      const file_name = files[i];
      const location = `${id}/images/${file_name}`;
      const localLocation = `${localImageLocation}${file_name}`;

      // scarico il file da supabase
      console.log("Downloading", location);
      // const { data: dataFiles, error: errorFiles } = await supabase.storage
      //   .from(BUCKET)
      //   .download(location);
      const get = await getObject(BUCKET, location);

      if (!get) {
        console.log("errorFiles");
        continue;
      }
      // scrivo il file in locale
      try {
        await fs.promises.writeFile(localLocation, get);
      } catch (e) {
        console.error(e);
      }
      // elimino il file da supabase
      // await supabase.storage.from(BUCKET).remove([location]);
      await deleteObject(BUCKET, location);
    }
  } catch (error) {
    console.error(error);
  }
};

/* Private - download files from telegram */
const _downloadFromTelegram = async (file_location, imgs) => {
  const promises = imgs.map((img) => request(img));
  const responses = await Promise.all(promises);

  try {
    await fs.promises.mkdir(file_location, { recursive: true });
  } catch (e) {
    console.error(e);
  }

  for (let i = 0; i < responses.length; i++) {
    const response = responses[i];
    const filename = imgs[i].split("/").pop();
    const file = fs.createWriteStream(`${file_location}/${filename}`);
    await response.body.pipe(file);
    console.log("Downloaded", filename);
  }

  return responses;
};
/* Private - upload files to supabase */
const _uploadDir = async ({ file_location, bucket_location }) => {
  const ret = [];
  const files = await walk(file_location);
  console.log("Uploading files:", files.length);
  const _files = await Promise.all(files);
  // _files.forEach(async ({ file, path }, i) => {
  for await (const { file, filename, contentType } of _files) {
    console.log("Uploading file: " + filename);
    const location = `${bucket_location}/model/${filename}`;

    // const { data, error } = await supabase.storage
    //   .from(BUCKET)
    //   .upload(location, await file, {
    //     contentType,
    //   });

    await putObject(BUCKET, location, await file);
    ret.push(location);
  }

  // return the position of the files
  return ret;
};

/* Main - WORKER */
async function worker({ project }) {
  console.log("worker");
  const { id, files, detail, ordering, feature, telegram_user } = project;
  let isTelegram = !!telegram_user;

  const imgDir = `projects/${id}/images`;
  const outDir = `projects/${id}/model/`;

  try {
    // download files from supabase
    if (!files || files.length === 0) throw new Error("No files to process");
    if (isTelegram) await _downloadFromTelegram(imgDir, files);
    else {
      await _downloadFiles(`${id}`, files);
    }

    // process
    await fs.promises.mkdir(outDir, { recursive: true });

    // await processor({
    queue.push({
      id,
      imgDir,
      outDir,
      filename: "model",
      detail,
      order: ordering,
      feature,
      isTelegram,
    });
  } catch (error) {
    console.log(error);
  }
}

const handler = async (id) => {
  try {
    const { data: project, error: errorProject } = await supabase
      .from("project")
      .select("*")
      .eq("id", id)
      .single();

    if (errorProject) throw errorProject;

    // MAIN WORKER
    await worker({ project });
  } catch (error) {
    console.log(error);
  }
};

// AMQP
amqp.connect(
  process.env.QUEUE_CONNECTION_STRING,
  function (error0, connection) {
    if (error0) throw error0;
    connection.createChannel(function (error1, channel) {
      if (error1) throw error1;

      var queue = "processing-dev";
      channel.assertQueue(queue, { durable: true });

      console.log(
        " [*] Waiting for messages in %s. To exit press CTRL+C",
        queue
      );

      channel.consume(
        queue,
        async (msg) => {
          channel.prefetch(1);
          console.log(" [x] Received %s", msg.content.toString());
          await handler(msg.content.toString());
          console.log("[x] Done", msg.content.toString());
          channel.ack(msg);
        },
        { noAck: false }
      );

      // const consumeMessage = function () {
      //   channel.get(queue, {}, async function (err, msg) {
      //     if (err) {
      //       console.log(err);
      //     } else {
      //       if (msg) {
      //         console.log(" [x] Received %s", msg.content.toString());
      //         handler(msg.content.toString()).then(() => {
      //           console.log("[x] Done", msg.content.toString());
      //           channel.ack(msg);
      //           consumeMessage();
      //         });
      //       } else {
      //         console.log("No message in queue");
      //         // if the queue is empty check every 5 seconds
      //         // una sorta di polling ma veramente losca...
      //         setTimeout(function () {
      //           consumeMessage();
      //         }, 5000);
      //       }
      //     }
      //   });
      // };

      // consumeMessage();
    });
  }
);
