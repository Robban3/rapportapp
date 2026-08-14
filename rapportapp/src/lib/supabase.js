import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

// Om env-variablerna saknas kör appen mot mock-datalagret (se api.js).
export const hasSupabase = Boolean(url && key)

export const supabase = hasSupabase ? createClient(url, key) : null
