const { Telegraf } = require("telegraf");
const dotenv = require("dotenv")
dotenv.config()
const BOT_TOKEN = process.env.BOT_TOKEN;
const bot = new Telegraf(BOT_TOKEN);
module.exports = bot