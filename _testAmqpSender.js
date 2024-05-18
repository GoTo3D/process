const amqp = require('amqplib/callback_api');
const dotenv = require('dotenv');
dotenv.config();
// send 100 message in queue
amqp.connect(process.env.QUEUE_CONNECTION_STRING, function(error0, connection) {
  if (error0) {
    throw error0;
  }
  connection.createChannel(function(error1, channel) {
    if (error1) {
      throw error1;
    }
    var queue = 'processing';
    for (let i = 0; i < 100; i++) {
        channel.sendToQueue(queue, Buffer.from(i.toString()), {
            persistent: true
        });
        console.log(" [x] Sent %s", i.toString());
    }
  });
  setTimeout(function() {
    connection.close();
    process.exit(0);
  }, 500);
});