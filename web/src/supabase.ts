import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Client Supabase du navigateur, avec la clé `anon` : publique par conception.
 * Ce sont les politiques RLS (rôle `authenticated` uniquement) qui protègent
 * les données ; sans session ouverte, les requêtes ne renvoient rien.
 */

// En CI, un secret absent donne une chaîne vide (pas undefined) : `||`, pas `??`.
const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || '';
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || '';

export const configError: string | null =
  url && anonKey
    ? null
    : 'Interface construite sans configuration Supabase : les secrets GitHub SUPABASE_URL et SUPABASE_ANON_KEY ' +
      'doivent exister au moment du build (Settings → Secrets and variables → Actions → Secrets), puis relancer le workflow « pages ».';

// createClient lève une erreur sur une URL vide : on lui donne des valeurs factices valides
// quand la configuration manque, et `configError` empêche tout appel réel.
export const supabase: SupabaseClient = createClient(url || 'https://non-configure.invalid', anonKey || 'non-configure');

/** `owner/repo`, pour le lien vers l'onglet Actions. */
export const GITHUB_REPO = (import.meta.env.VITE_GITHUB_REPO as string | undefined) || null;

export const PAGE_SIZE = 25;
