import { resolveFilterConfig } from '../core/config';
import { dedupHash, dedupeOffers, offerKey } from '../core/dedup';
import { evaluateOffer } from '../core/filter';
import type { FilterConfig, JobSource } from '../core/types';
import { buildSourcesFromEnv } from '../sources';
import { isMain } from './is-main';
import type { FetchRepository, JobOfferInsert, SourceRunInsert } from './repository';
import { createServiceClient, SupabaseRepository } from './supabase';

/**
 * Tâche `fetch` : interroge toutes les sources, normalise, déduplique, filtre,
 * stocke, puis écrit une ligne dans `source_runs` par source.
 *
 * Ordre : récupérer → dédupliquer → filtrer → stocker. La déduplication passe
 * avant le filtrage pour ne pas réévaluer une offre déjà connue ; le filtrage
 * passe avant le stockage pour renseigner le motif de rejet.
 */

export interface FetchDeps {
  sources: readonly JobSource[];
  repo: FetchRepository;
  /** Configuration imposée (tests) ; sinon lue depuis `settings`. */
  config?: FilterConfig;
  log?: (message: string) => void;
}

export interface FetchSummary {
  runs: SourceRunInsert[];
  /** Vrai seulement si toutes les sources ont échoué. */
  allFailed: boolean;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function processSource(
  source: JobSource,
  repo: FetchRepository,
  config: FilterConfig,
  log: (message: string) => void,
): Promise<SourceRunInsert> {
  const run: SourceRunInsert = {
    source: source.name,
    label: source.label,
    succeeded: false,
    fetched: 0,
    created: 0,
    rejected: 0,
    duplicates: 0,
    error_message: null,
  };

  const offers = await source.fetch();
  run.fetched = offers.length;
  log(`[${source.label}] ${offers.length} offre(s) récupérée(s)`);

  // Déduplication : clé (source, externalId) puis empreinte toutes sources confondues.
  const knownIds = await repo.findExistingExternalIds(source.name, offers.map((o) => o.externalId));
  const knownKeys = new Set([...knownIds].map((id) => offerKey(source.name, id)));
  const hashes = await Promise.all(offers.map((o) => dedupHash(o.title, o.company)));
  const knownHashes = await repo.findExistingHashes([...new Set(hashes)]);
  const { fresh, duplicates } = await dedupeOffers(offers, { keys: knownKeys, hashes: knownHashes });
  run.duplicates = duplicates.length;

  // Filtrage, puis stockage avec le motif de rejet.
  const rows: JobOfferInsert[] = fresh.map(({ offer, hash }) => {
    const decision = evaluateOffer(offer, config);
    if (decision.accepted) run.created += 1;
    else run.rejected += 1;
    return {
      source: offer.source,
      external_id: offer.externalId,
      title: offer.title,
      company: offer.company,
      location: offer.location,
      contract_type: offer.contractType,
      sector: offer.sector,
      naf_code: offer.nafCode,
      salary: offer.salary,
      url: offer.url,
      description: offer.description,
      published_at: offer.publishedAt,
      dedup_hash: hash,
      status: decision.accepted ? 'new' : 'rejected',
      rejection_reason: decision.accepted ? null : decision.reason,
      rejection_detail: decision.accepted ? null : decision.detail,
    };
  });
  if (rows.length > 0) await repo.insertOffers(rows);

  run.succeeded = true;
  log(`[${source.label}] ${run.created} retenue(s), ${run.rejected} écartée(s), ${run.duplicates} doublon(s)`);
  return run;
}

export async function runFetch(deps: FetchDeps): Promise<FetchSummary> {
  const log = deps.log ?? (() => {});
  const config = deps.config ?? resolveFilterConfig(await deps.repo.loadSettings());
  const runs: SourceRunInsert[] = [];

  for (const source of deps.sources) {
    let run: SourceRunInsert;
    // Chaque source dans son propre try/catch : une API indisponible n'empêche pas les autres.
    try {
      run = await processSource(source, deps.repo, config, log);
    } catch (error) {
      run = {
        source: source.name,
        label: source.label,
        succeeded: false,
        fetched: 0,
        created: 0,
        rejected: 0,
        duplicates: 0,
        error_message: errorMessage(error),
      };
      log(`[${source.label}] ÉCHEC : ${run.error_message}`);
    }
    try {
      await deps.repo.insertSourceRun(run);
    } catch (error) {
      log(`[${source.label}] impossible d'enregistrer l'exécution : ${errorMessage(error)}`);
    }
    runs.push(run);
  }

  const allFailed = runs.length > 0 && runs.every((r) => !r.succeeded);
  return { runs, allFailed };
}

async function main(): Promise<void> {
  const log = (message: string) => console.log(message);
  const sources = buildSourcesFromEnv(process.env, log);
  if (sources.length === 0) {
    throw new Error('Aucune source configurée : renseigner les identifiants Adzuna et/ou France Travail.');
  }

  const repo = new SupabaseRepository(createServiceClient());
  const summary = await runFetch({ sources, repo, log });
  if (summary.allFailed) {
    const details = summary.runs.map((r) => `${r.label} (${r.error_message})`).join(' ; ');
    throw new Error(`Toutes les sources ont échoué : ${details}`);
  }
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
