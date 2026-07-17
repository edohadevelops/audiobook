import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Fail loudly at startup rather than showing a blank screen later on.
export const supabaseConfigError =
  !SUPABASE_URL || !SUPABASE_ANON_KEY
    ? "Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env file, then restart the dev server."
    : "";

export const supabase = supabaseConfigError
  ? null
  : createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
