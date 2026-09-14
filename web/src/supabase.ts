import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Client Supabase du navigateur, avec la clé `anon` : publique par conception.
 * Ce sont les politiques RLS (rôle `authenticated` uniquement) qui protègent
 * les données ; sans session ouverte, les requêtes ne renvoient rien.
 */

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const configError: string | null =
  url && anonKey ? null : 'VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY doivent être définies au moment du build.';

export const supabase: SupabaseClient = createClient(url ?? 'https://invalid.local', anonKey ?? 'missing');

/** `owner/repo`, pour le lien vers l'onglet Actions. */
export const GITHUB_REPO = (import.meta.env.VITE_GITHUB_REPO as string | undefined) || null;

export const PAGE_SIZE = 25;
