'use client';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// NEXT_PUBLIC_ 값은 빌드할 때 화면 코드에 들어간다. anon(publishable) 키는 공개용이며 RLS로 보호한다.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

export const supabaseConfigured = /^https?:\/\//.test(url) && anon.length > 20;

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (!supabaseConfigured) return null;
  if (!client) {
    client = createClient(url, anon, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'pa-insight-auth' },
    });
  }
  return client;
}
