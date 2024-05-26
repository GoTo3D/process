const { supabase } = require("../lib/supabaseClient");

supabase.from("project").select("*").limit(1).order("id", { ascending: false}).then(console.log).catch(console.error);