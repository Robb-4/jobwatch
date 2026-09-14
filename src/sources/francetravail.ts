import { normalizeContractType } from '../core/contract';
import type { JobOffer, JobSource } from '../core/types';
import { defaultFetch, defaultSleep, errorExcerpt, type FetchLike, type SleepLike } from './http';

/**
 * France Travail — API Offres d'emploi v2.
 *
 * ⚠️ Écrit d'après la documentation, jamais validé contre l'API réelle faute
 * d'identifiants. Points à vérifier au premier appel réel (voir README) :
 * - `motsCles` cherche probablement dans tout le texte (comme `what_or` chez
 *   Adzuna) : le filtrage local sur le titre compense, mais le volume d'offres
 *   rejetées peut être élevé. Par défaut on ne cherche que « data ».
 * - les plages d'IP de GitHub Actions doivent être acceptées par le profil.
 */

export interface FranceTravailOptions {
  clientId: string;
  clientSecret: string;
  fetchImpl?: FetchLike;
  sleep?: SleepLike;
  now?: () => number;
  /** Une recherche par entrée (mots-clés séparés par des virgules), fusionnées ensuite. */
  keywordSearches?: readonly string[];
  typeContrat?: string;
  /** Codes d'expérience : 1 = débutant, 2 = 1 à 3 ans, 3 = plus de 3 ans. */
  experience?: string;
  publieeDepuis?: number;
  /** 150 maximum par appel. */
  pageSize?: number;
  maxPages?: number;
  /** Pause entre deux appels (limite annoncée ~10 req/s). */
  minDelayMs?: number;
  tokenUrl?: string;
  searchUrl?: string;
  scope?: string;
}

export const FRANCETRAVAIL_TOKEN_URL =
  'https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire';
export const FRANCETRAVAIL_SEARCH_URL = 'https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search';
export const FRANCETRAVAIL_SCOPE = 'api_offresdemploiv2 o2dsoffre';
export const DEFAULT_FRANCETRAVAIL_SEARCHES: readonly string[] = ['data'];

interface FranceTravailOffer {
  id: string;
  intitule?: string;
  entreprise?: { nom?: string };
  lieuTravail?: { libelle?: string };
  typeContrat?: string;
  typeContratLibelle?: string;
  codeNAF?: string;
  secteurActivite?: string;
  secteurActiviteLibelle?: string;
  salaire?: { libelle?: string; commentaire?: string };
  origineOffre?: { urlOrigine?: string };
  description?: string;
  dateCreation?: string;
}

interface FranceTravailSearchResponse {
  resultats?: FranceTravailOffer[];
}

interface TokenResponse {
  access_token: string;
  expires_in?: number;
}

/** Marge retirée à l'expiration du jeton avant de le renouveler. */
const TOKEN_MARGIN_MS = 60_000;

export function mapFranceTravailOffer(offer: FranceTravailOffer): JobOffer {
  return {
    source: 'francetravail',
    externalId: String(offer.id),
    title: offer.intitule?.trim() ?? '',
    company: offer.entreprise?.nom?.trim() || null,
    location: offer.lieuTravail?.libelle?.trim() || null,
    contractType: normalizeContractType(offer.typeContrat ?? offer.typeContratLibelle),
    sector: offer.secteurActiviteLibelle?.trim() || null,
    // `codeNAF` (ex. 6201Z) quand présent, sinon la division `secteurActivite` (ex. 62).
    nafCode: offer.codeNAF?.trim() || offer.secteurActivite?.trim() || null,
    salary: offer.salaire?.libelle?.trim() || offer.salaire?.commentaire?.trim() || null,
    url: offer.origineOffre?.urlOrigine || `https://candidat.francetravail.fr/offres/recherche/detail/${offer.id}`,
    description: offer.description ?? '',
    publishedAt: offer.dateCreation ?? null,
  };
}

export class FranceTravailSource implements JobSource {
  readonly name = 'francetravail';
  readonly label = 'France Travail';

  private readonly fetchImpl: FetchLike;
  private readonly sleep: SleepLike;
  private readonly now: () => number;
  private readonly searches: readonly string[];
  private readonly pageSize: number;
  private readonly maxPages: number;
  private readonly minDelayMs: number;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(private readonly options: FranceTravailOptions) {
    if (!options.clientId || !options.clientSecret) {
      throw new Error('France Travail : FRANCETRAVAIL_CLIENT_ID et FRANCETRAVAIL_CLIENT_SECRET sont requis.');
    }
    this.fetchImpl = options.fetchImpl ?? defaultFetch;
    this.sleep = options.sleep ?? defaultSleep;
    this.now = options.now ?? Date.now;
    this.searches = options.keywordSearches ?? DEFAULT_FRANCETRAVAIL_SEARCHES;
    this.pageSize = Math.min(options.pageSize ?? 150, 150);
    this.maxPages = options.maxPages ?? 10;
    this.minDelayMs = options.minDelayMs ?? 150;
  }

  /** Jeton OAuth2 client_credentials, mis en cache jusqu'à expiration moins une marge. */
  async getToken(): Promise<string> {
    if (this.token && this.now() < this.token.expiresAt - TOKEN_MARGIN_MS) return this.token.value;

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.options.clientId,
      client_secret: this.options.clientSecret,
      scope: this.options.scope ?? FRANCETRAVAIL_SCOPE,
    });
    let response: Response;
    try {
      response = await this.fetchImpl(this.options.tokenUrl ?? FRANCETRAVAIL_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
    } catch (error) {
      throw new Error(`France Travail : serveur d'authentification injoignable — ${String(error)}`);
    }
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`France Travail : authentification refusée (HTTP ${response.status}) — ${errorExcerpt(text)}`);
    }
    let json: TokenResponse;
    try {
      json = JSON.parse(text) as TokenResponse;
    } catch {
      throw new Error(`France Travail : réponse d'authentification non JSON — ${errorExcerpt(text)}`);
    }
    if (!json.access_token) throw new Error('France Travail : jeton absent de la réponse d’authentification.');
    const ttlMs = (json.expires_in ?? 1500) * 1000;
    this.token = { value: json.access_token, expiresAt: this.now() + ttlMs };
    return this.token.value;
  }

  buildSearchUrl(motsCles: string, start: number): string {
    const params = new URLSearchParams({
      motsCles,
      typeContrat: this.options.typeContrat ?? 'CDI',
      experience: this.options.experience ?? '1,2',
      publieeDepuis: String(this.options.publieeDepuis ?? 7),
      range: `${start}-${start + this.pageSize - 1}`,
    });
    return `${this.options.searchUrl ?? FRANCETRAVAIL_SEARCH_URL}?${params.toString()}`;
  }

  async fetch(): Promise<JobOffer[]> {
    const byId = new Map<string, JobOffer>();
    for (const motsCles of this.searches) {
      for (let page = 0; page < this.maxPages; page += 1) {
        const start = page * this.pageSize;
        const { offers, hasMore } = await this.fetchRange(motsCles, start);
        for (const offer of offers) {
          if (!byId.has(offer.externalId)) byId.set(offer.externalId, offer);
        }
        if (!hasMore) break;
        if (this.minDelayMs > 0) await this.sleep(this.minDelayMs);
      }
    }
    return [...byId.values()];
  }

  private async fetchRange(motsCles: string, start: number): Promise<{ offers: JobOffer[]; hasMore: boolean }> {
    const token = await this.getToken();
    const url = this.buildSearchUrl(motsCles, start);
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });
    } catch (error) {
      throw new Error(`France Travail : appel réseau impossible (« ${motsCles} », range ${start}) — ${String(error)}`);
    }

    // 204 : plus rien. 400 au-delà de la première page : plage hors volume, fin de pagination.
    if (response.status === 204) return { offers: [], hasMore: false };
    if (response.status === 400 && start > 0) return { offers: [], hasMore: false };

    const text = await response.text();
    if (response.status !== 200 && response.status !== 206) {
      throw new Error(
        `France Travail : HTTP ${response.status} pour « ${motsCles} » range ${start} — ${errorExcerpt(text)}`,
      );
    }
    let json: FranceTravailSearchResponse;
    try {
      json = JSON.parse(text) as FranceTravailSearchResponse;
    } catch {
      throw new Error(`France Travail : réponse non JSON pour « ${motsCles} » — ${errorExcerpt(text)}`);
    }
    const results = Array.isArray(json.resultats) ? json.resultats : [];
    // 206 = contenu partiel, il reste des résultats ; 200 = plage complète, dernière page.
    return { offers: results.map(mapFranceTravailOffer), hasMore: response.status === 206 && results.length > 0 };
  }
}
