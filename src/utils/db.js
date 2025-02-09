const dotenv = require('dotenv')
const { supabase } = require("../lib/supabaseClient");
dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;

const getProject = async (id) => {
    const { data, error } = await supabase
      .from("project")
      .select("*")
      .eq("id", id)
      .single();
    if(error) throw error
    return data
}

const getTelegramUser = async (telegram_user) => {
    const { data, error } = await supabase
      .from("telegram_user")
      .select("user_id")
      .eq("id", telegram_user)
      .single();
    if(error) throw error
    return data
}

const updateProject = async (id, updateObj) => {
    const { error } = await supabase
      .from("project")
      .update(updateObj)
      .eq("id", id);

    if(error) throw error
    return 
}

module.exports = {
    getProject,
    getTelegramUser,
    updateProject
}