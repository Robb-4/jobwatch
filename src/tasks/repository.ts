import type { RejectionReason, SettingRow } from '../core/types';

/**
 * Accès aux données vu par les tâches. Les tâches ne parlent qu'à ces
 * interfaces : `supabase.ts` les implémente, les tests les simulent en mémoire.
 */

export type OfferStatus = 'new' | 'reported' | 'rejected';

export interface JobOfferInsert {
  source: string;
  external_id: string;
  title: string;
  company: string | null;
  location: string | null;
  contract_type: string | null;
  sector: string | null;
  naf_code: string | null;
  salary: string | null;
  url: string;
  description: string;
  published_at: string | null;
  dedup_hash: string;
  status: OfferStatus;
  rejection_reason: RejectionReason | null;
  rejection_detail: string | null;
}

export interface JobOfferRow extends JobOfferInsert {
  id: number;
  personal_status: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
  reported_at: string | null;
}

export interface SourceRunInsert {
  source: string;
  label: string;
  succeeded: boolean;
  fetched: number;
  created: number;
  rejected: number;
  duplicates: number;
  error_message: string | null;
}

export interface SourceRunRow extends SourceRunInsert {
  id: number;
  created_at: string;
  reported_at: string | null;
}

export interface FetchRepository {
  loadSettings(): Promise<SettingRow[]>;
  /** Parmi `externalIds`, ceux déjà importés depuis `source`. */
  findExistingExternalIds(source: string, externalIds: readonly string[]): Promise<Set<string>>;
  /** Parmi `hashes`, ceux déjà présents, toutes sources confondues. */
  findExistingHashes(hashes: readonly string[]): Promise<Set<string>>;
  insertOffers(rows: readonly JobOfferInsert[]): Promise<void>;
  insertSourceRun(run: SourceRunInsert): Promise<void>;
}

export interface ReportRepository {
  /** Offres en `new`, par date de publication décroissante. */
  loadNewOffers(): Promise<JobOfferRow[]>;
  /** Exécutions pas encore comptabilisées dans un rapport. */
  loadUnreportedRuns(): Promise<SourceRunRow[]>;
  markOffersReported(ids: readonly number[], reportedAt: string): Promise<void>;
  markRunsReported(ids: readonly number[], reportedAt: string): Promise<void>;
}

export interface PurgeRepository {
  /** Supprime les offres importées avant `before` (ISO 8601) ; renvoie le nombre supprimé. */
  deleteOffersCreatedBefore(before: string): Promise<number>;
}
