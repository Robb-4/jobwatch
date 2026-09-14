import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { SettingRow } from '../core/types';
import { requireEnv } from './env';
import type {
  FetchRepository,
  JobOfferInsert,
  JobOfferRow,
  PurgeRepository,
  ReportRepository,
  SourceRunInsert,
  SourceRunRow,
} from './repository';

/**
 * Implémentation Supabase des dépôts, avec la clé `service_role` (contourne
 * RLS : voulu côté serveur, jamais côté navigateur).
 */

/** Taille des lots pour les filtres `in` et les insertions. */
const CHUNK = 200;

function chunks<T>(items: readonly T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function fail(context: string, error: { message: string } | null): never {
  throw new Error(`Supabase : ${context} — ${error?.message ?? 'erreur inconnue'}`);
}

export function createServiceClient(): SupabaseClient {
  return createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export class SupabaseRepository implements FetchRepository, ReportRepository, PurgeRepository {
  constructor(private readonly client: SupabaseClient) {}

  async loadSettings(): Promise<SettingRow[]> {
    const { data, error } = await this.client.from('settings').select('key, value');
    if (error) fail('lecture de settings', error);
    return (data ?? []) as SettingRow[];
  }

  async findExistingExternalIds(source: string, externalIds: readonly string[]): Promise<Set<string>> {
    const found = new Set<string>();
    for (const batch of chunks(externalIds)) {
      const { data, error } = await this.client
        .from('job_offers')
        .select('external_id')
        .eq('source', source)
        .in('external_id', batch);
      if (error) fail('recherche des identifiants existants', error);
      for (const row of data ?? []) found.add(String((row as { external_id: string }).external_id));
    }
    return found;
  }

  async findExistingHashes(hashes: readonly string[]): Promise<Set<string>> {
    const found = new Set<string>();
    for (const batch of chunks(hashes)) {
      const { data, error } = await this.client.from('job_offers').select('dedup_hash').in('dedup_hash', batch);
      if (error) fail('recherche des empreintes existantes', error);
      for (const row of data ?? []) found.add(String((row as { dedup_hash: string }).dedup_hash));
    }
    return found;
  }

  async insertOffers(rows: readonly JobOfferInsert[]): Promise<void> {
    for (const batch of chunks(rows)) {
      // `ignoreDuplicates` : une course entre deux exécutions ne doit pas faire échouer le lot.
      const { error } = await this.client
        .from('job_offers')
        .upsert(batch, { onConflict: 'source,external_id', ignoreDuplicates: true });
      if (error) fail('insertion des offres', error);
    }
  }

  async insertSourceRun(run: SourceRunInsert): Promise<void> {
    const { error } = await this.client.from('source_runs').insert(run);
    if (error) fail("insertion d'une exécution", error);
  }

  async loadNewOffers(): Promise<JobOfferRow[]> {
    const { data, error } = await this.client
      .from('job_offers')
      .select('*')
      .eq('status', 'new')
      .order('published_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false });
    if (error) fail('lecture des offres à rapporter', error);
    return (data ?? []) as JobOfferRow[];
  }

  async loadUnreportedRuns(): Promise<SourceRunRow[]> {
    const { data, error } = await this.client
      .from('source_runs')
      .select('*')
      .is('reported_at', null)
      .order('created_at', { ascending: true });
    if (error) fail('lecture des exécutions', error);
    return (data ?? []) as SourceRunRow[];
  }

  async markOffersReported(ids: readonly number[], reportedAt: string): Promise<void> {
    for (const batch of chunks(ids)) {
      const { error } = await this.client
        .from('job_offers')
        .update({ status: 'reported', reported_at: reportedAt })
        .in('id', batch);
      if (error) fail('marquage des offres rapportées', error);
    }
  }

  async markRunsReported(ids: readonly number[], reportedAt: string): Promise<void> {
    for (const batch of chunks(ids)) {
      const { error } = await this.client.from('source_runs').update({ reported_at: reportedAt }).in('id', batch);
      if (error) fail('marquage des exécutions rapportées', error);
    }
  }

  async deleteOffersCreatedBefore(before: string): Promise<number> {
    const { count, error } = await this.client
      .from('job_offers')
      .delete({ count: 'exact' })
      .lt('created_at', before);
    if (error) fail('purge des offres', error);
    return count ?? 0;
  }
}
