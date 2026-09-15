import { normalizeContractType } from '../core/contract';
import type { JobOffer, JobSource } from '../core/types';
import { defaultFetch, defaultSleep, errorExcerpt, fetchWithRetry, type FetchLike, type SleepLike } from './http';

/**
 * Adzuna — API Jobs France.
 *
 * Faits vérifiés en conditions réelles (voir README) :
 * - le CDI se demande par `permanent=1` ; `contract_type=permanent` renvoie un 400 HTML ;
 * - chercher dans le titre seul avec `title_only`, jamais `what_or` (qui ramène
 *   tout ce qui contient « données » dans un paragraphe RGPD) ;
 * - `title_only` combine ses mots en ET : on enchaîne plusieurs recherches et
 *   la déduplication fusionne les recouvrements ;
 * - l'API renvoie parfois un 503 HTML sur une page isolée : on réessaie, et si
 *   la panne persiste au-delà de la première page, on garde ce qui a déjà été
 *   récupéré (la récupération suivante, deux heures plus tard, complètera).
 */

export interface AdzunaSearch {
  /** Mots cherchés dans le titre uniquement (ET entre les mots). */
  title_only: string;
}

export interface AdzunaOptions {
  appId: string;
  appKey: string;
  fetchImpl?: FetchLike;
  sleep?: SleepLike;
  /** Journal des incidents non bloquants (page abandonnée après nouvelles tentatives). */
  warn?: (message: string) => void;
  /** Recherches enchaînées puis fusionnées. */
  searches?: readonly AdzunaSearch[];
  /** Plafond de pages par recherche (50 résultats par page). */
  maxPages?: number;
  /** Maximum accepté par l'API : 50. */
  resultsPerPage?: number;
  maxDaysOld?: number;
  /** Mots exclus côté API (le filtrage local reste la référence). */
  whatExclude?: string;
  country?: string;
  baseUrl?: string;
}

/** Point de départ validé : « data » seul, puis « analyste données ». */
export const DEFAULT_ADZUNA_SEARCHES: readonly AdzunaSearch[] = [
  { title_only: 'data' },
  { title_only: 'analyste données' },
];

export const ADZUNA_BASE_URL = 'https://api.adzuna.com/v1/api/jobs';

interface AdzunaResult {
  id: string | number;
  title?: string;
  company?: { display_name?: string };
  location?: { display_name?: string };
  contract_type?: string;
  category?: { label?: string };
  salary_min?: number;
  salary_max?: number;
  salary_is_predicted?: string;
  redirect_url?: string;
  description?: string;
  created?: string;
}

interface AdzunaResponse {
  count?: number;
  results?: AdzunaResult[];
}

const euro = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

/** Salaire affichable ; null si absent ou estimé par Adzuna (`salary_is_predicted === '1'`). */
export function formatAdzunaSalary(result: AdzunaResult): string | null {
  if (result.salary_is_predicted === '1') return null;
  const min = result.salary_min;
  const max = result.salary_max;
  if (!min && !max) return null;
  if (min && max && min !== max) return `${euro.format(min)} – ${euro.format(max)} €`;
  return `${euro.format((min || max) as number)} €`;
}

export function mapAdzunaResult(result: AdzunaResult): JobOffer {
  return {
    source: 'adzuna',
    externalId: String(result.id),
    title: result.title?.trim() ?? '',
    company: result.company?.display_name?.trim() || null,
    location: result.location?.display_name?.trim() || null,
    contractType: normalizeContractType(result.contract_type),
    sector: result.category?.label?.trim() || null,
    // Adzuna ne fournit pas de code NAF : la règle NAF ne s'applique pas à cette source.
    nafCode: null,
    salary: formatAdzunaSalary(result),
    url: result.redirect_url ?? '',
    description: result.description ?? '',
    publishedAt: result.created ?? null,
  };
}

export class AdzunaSource implements JobSource {
  readonly name = 'adzuna';
  readonly label = 'Adzuna';

  private readonly fetchImpl: FetchLike;
  private readonly sleep: SleepLike;
  private readonly warn: (message: string) => void;
  private readonly searches: readonly AdzunaSearch[];
  private readonly maxPages: number;
  private readonly resultsPerPage: number;
  private readonly maxDaysOld: number;
  private readonly whatExclude: string;
  private readonly baseUrl: string;

  constructor(private readonly options: AdzunaOptions) {
    if (!options.appId || !options.appKey) {
      throw new Error('Adzuna : ADZUNA_APP_ID et ADZUNA_APP_KEY sont requis.');
    }
    this.fetchImpl = options.fetchImpl ?? defaultFetch;
    this.sleep = options.sleep ?? defaultSleep;
    this.warn = options.warn ?? ((message) => console.warn(message));
    this.searches = options.searches ?? DEFAULT_ADZUNA_SEARCHES;
    this.maxPages = options.maxPages ?? 5;
    this.resultsPerPage = Math.min(options.resultsPerPage ?? 50, 50);
    this.maxDaysOld = options.maxDaysOld ?? 7;
    this.whatExclude = options.whatExclude ?? 'banque finance banking assurance';
    this.baseUrl = `${options.baseUrl ?? ADZUNA_BASE_URL}/${options.country ?? 'fr'}/search`;
  }

  /** URL d'une page pour une recherche donnée (pages numérotées à partir de 1). */
  buildUrl(search: AdzunaSearch, page: number): string {
    const params = new URLSearchParams({
      app_id: this.options.appId,
      app_key: this.options.appKey,
      'content-type': 'application/json',
      results_per_page: String(this.resultsPerPage),
      sort_by: 'date',
      max_days_old: String(this.maxDaysOld),
      // Drapeau booléen : `contract_type=permanent` provoque un HTTP 400.
      permanent: '1',
      what_exclude: this.whatExclude,
      title_only: search.title_only,
    });
    return `${this.baseUrl}/${page}?${params.toString()}`;
  }

  async fetch(): Promise<JobOffer[]> {
    const byId = new Map<string, JobOffer>();
    for (const search of this.searches) {
      for (let page = 1; page <= this.maxPages; page += 1) {
        let results: AdzunaResult[];
        try {
          results = await this.fetchPage(search, page);
        } catch (error) {
          // Rien de récupéré du tout : vraie panne, à remonter. Sinon on garde l'acquis.
          if (byId.size === 0) throw error;
          this.warn(`Adzuna : page ${page} de « ${search.title_only} » abandonnée, ${byId.size} offre(s) conservée(s) — ${String(error instanceof Error ? error.message : error)}`);
          break;
        }
        for (const result of results) {
          const offer = mapAdzunaResult(result);
          if (!byId.has(offer.externalId)) byId.set(offer.externalId, offer);
        }
        // Dernière page dès qu'elle est incomplète.
        if (results.length < this.resultsPerPage) break;
      }
    }
    return [...byId.values()];
  }

  private async fetchPage(search: AdzunaSearch, page: number): Promise<AdzunaResult[]> {
    const url = this.buildUrl(search, page);
    let response: Response;
    try {
      response = await fetchWithRetry(this.fetchImpl, url, { headers: { Accept: 'application/json' } }, this.sleep);
    } catch (error) {
      throw new Error(`Adzuna : appel réseau impossible (« ${search.title_only} », page ${page}) — ${String(error)}`);
    }
    const body = await response.text();
    if (!response.ok) {
      throw new Error(
        `Adzuna : HTTP ${response.status} pour « ${search.title_only} » page ${page} — ${errorExcerpt(body)}`,
      );
    }
    let json: AdzunaResponse;
    try {
      json = JSON.parse(body) as AdzunaResponse;
    } catch {
      throw new Error(`Adzuna : réponse non JSON pour « ${search.title_only} » page ${page} — ${errorExcerpt(body)}`);
    }
    return Array.isArray(json.results) ? json.results : [];
  }
}
