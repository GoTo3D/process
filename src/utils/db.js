const { z } = require('zod');
const { supabase } = require('../lib/supabaseClient');

const ProjectSchema = z.object({
  id: z.number().int().positive(),
  status: z.string(),
  files: z.array(z.string()).min(1, 'Project must have at least one file'),
  detail: z.string().nullable().optional().default('medium'),
  feature: z.string().nullable().optional().default('normal'),
  order: z.string().nullable().optional().default('unordered'),
  telegram_user: z.number().int().positive().nullable().optional(),
  process_start: z.string().nullable().optional(),
  process_end: z.string().nullable().optional(),
  model_urls: z.array(z.string()).nullable().optional(),
  model_dimensions: z.object({
    dimensions: z.object({
      width: z.number(),
      height: z.number(),
      depth: z.number(),
    }),
    bounding_box: z.object({
      min: z.object({ x: z.number(), y: z.number(), z: z.number() }),
      max: z.object({ x: z.number(), y: z.number(), z: z.number() }),
    }),
    unit: z.string(),
  }).nullable().optional(),
}).passthrough();

const TelegramUserSchema = z.object({
  user_id: z.union([z.string(), z.number()]),
});

const getProject = async (id) => {
  const { data, error } = await supabase
    .from('project')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw error;

  return ProjectSchema.parse(data);
};

const getTelegramUser = async (telegram_user) => {
  const { data, error } = await supabase
    .from('telegram_user')
    .select('user_id')
    .eq('id', telegram_user)
    .single();
  if (error) throw error;

  return TelegramUserSchema.parse(data);
};

const updateProject = async (id, updateObj) => {
  const { error } = await supabase
    .from('project')
    .update(updateObj)
    .eq('id', id);
  if (error) throw error;
};

module.exports = { getProject, getTelegramUser, updateProject };
