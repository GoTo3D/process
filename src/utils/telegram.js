const bot = require('../lib/telegramClient');

const sendMessage = async (user_id, message) => {
  await bot.telegram.sendMessage(user_id, message);
};

const sendDocument = async (user_id, source) => {
  await bot.telegram.sendDocument(user_id, { source });
};

module.exports = { sendMessage, sendDocument };
