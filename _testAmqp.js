var amqp = require('amqplib/callback_api');
var dotenv = require('dotenv');
var supabase = require('@supabase/supabase-js');
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

const supabaseClient = supabase.createClient(supabaseUrl, supabaseKey);

amqp.connect(process.env.QUEUE_CONNECTION_STRING, function(error0, connection) {
  if (error0) {
    throw error0;
  }
  connection.createChannel(function(error1, channel) {
    if (error1) {
      throw error1;
    }
    var queue = 'processing';
    channel.assertQueue(queue, { durable: false });

    console.log(" [*] Waiting for messages in %s. To exit press CTRL+C", queue);
    
    const consumeMessage = function(){
      channel.get(queue, {}, function(err, msg){
        if (err) {
          console.log(err);
        } else {
          if (msg) {
            console.log(" [x] Received %s", msg.content.toString());
            setTimeout(function() {
              console.log("[x] Done", msg.content.toString());
              channel.ack(msg);
              consumeMessage();
            }, 500);
          } else {
            console.log("No message in queue");
            setTimeout(function() {
              consumeMessage();
            }, 5000);
          }
        }
      });
    }

    consumeMessage();
    // channel.consume(queue, function(msg) {
    //     channel.prefetch(1);
    //     console.log(" [x] Received %s", msg.content.toString());
    //     // await supabaseClient.from('Process').delete().eq('id', msg.content.toString());
    //     setTimeout(function() {
    //       console.log("[x] Done", msg.content.toString());
    //       channel.ack(msg);
    //     }, 10000);
    // }, { noAck: false });
  });
});