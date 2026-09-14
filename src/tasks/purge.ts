import { optionalIntEnv } from './env';
import { isMain } from './is-main';
import type { PurgeRepository } from './repository';
import { createServiceClient, SupabaseRepository } from './supabase';

/**
 * Tâche `purge` : supprime les offres importées il y a plus de N jours
 * (date d'import `created_at`, pas date de publication).
 */

export const DEFAULT_PURGE_DAYS = 60;

export function purgeCutoff(now: Date, days: number): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

export async function runPurge(repo: PurgeRepository, days: number, now = new Date()): Promise<number> {
  return repo.deleteOffersCreatedBefore(purgeCutoff(now, days));
}

async function main(): Promise<void> {
  const days = optionalIntEnv('PURGE_DAYS', DEFAULT_PURGE_DAYS);
  const deleted = await runPurge(new SupabaseRepository(createServiceClient()), days);
  console.log(`${deleted} offre(s) importée(s) il y a plus de ${days} jours supprimée(s).`);
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
