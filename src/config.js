const { z } = require('zod');

// Carica dotenv UNA sola volta, qui
require('dotenv').config();

const ConfigSchema = z.object({
  // Supabase
  SUPABASE_URL: z.string().url(),
  SUPABASE_KEY: z.string().min(1),

  // Telegram
  BOT_TOKEN: z.string().min(1),

  // Cloudflare R2
  CLOUDFLARE_R2_ACCOUNT_ID: z.string().min(1),
  CLOUDFLARE_R2_ACCESS_KEY_ID: z.string().min(1),
  CLOUDFLARE_R2_SECRET_ACCESS_KEY: z.string().min(1),

  // Queue
  QUEUE_CONNECTION_STRING: z.string().min(1),
  QUEUE: z.string().default('processing-dev'),

  // Storage
  BUCKET: z.string().min(1),

  // Processing
  PROJECTS_BASE_DIR: z.string().default('/Volumes/T7/projects'),
});

const result = ConfigSchema.safeParse(process.env);

if (!result.success) {
  console.error('Invalid environment configuration:');
  console.error(result.error.format());
  process.exit(1);
}

module.exports = result.data;
