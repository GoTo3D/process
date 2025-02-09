const bot = require("../lib/telegramClient");

const sendMessage = (user_id, message) => {
    bot.telegram.sendMessage(user_id, message);
}
const sendDocument = async (user_id, source) => {
    try {
        await bot.telegram.sendDocument(user_id, { source });
    } catch (error) {
        throw error
    }
}

module.exports = {
    sendMessage,
    sendDocument
}