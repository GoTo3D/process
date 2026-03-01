/**
 * Client Supabase con service_role key per bypassare RLS
 * Usato solo nei test per creare/eliminare progetti
 */
const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseServiceKey) {
  console.warn('[WARNING] SUPABASE_SERVICE_KEY not set. Integration tests that create projects will fail.');
  console.warn('Add SUPABASE_SERVICE_KEY to your .env file to enable full integration tests.');
  console.warn('You can find it in Supabase Dashboard > Settings > API > service_role key\n');
}

const supabaseAdmin = supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })
  : null;

module.exports = { supabaseAdmin };
