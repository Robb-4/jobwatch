/** Injection de `fetch` pour tester les sources avec du HTTP simulé. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const defaultFetch: FetchLike = (input, init) => globalThis.fetch(input, init);

/** Extrait lisible du corps d'une réponse d'erreur (HTML ou JSON), tronqué. */
export function errorExcerpt(body: string, max = 200): string {
  const text = body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Attente injectable (limite de débit, nouvelles tentatives), remplacée par un no-op dans les tests. */
export type SleepLike = (ms: number) => Promise<void>;

export const defaultSleep: SleepLike = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Délais entre deux tentatives sur une erreur passagère (HTTP 5xx, 429, ou
 * échec réseau). Observé en production : Adzuna renvoie parfois un 503 HTML
 * « Uh oh, something isn't right » sur une page isolée.
 */
export const RETRY_DELAYS_MS: readonly number[] = [1_000, 3_000];

export function isTransientStatus(status: number): boolean {
  return status >= 500 || status === 429;
}

/**
 * Appelle `fetchImpl` en réessayant sur erreur passagère. Renvoie la dernière
 * réponse (même en erreur) ; lève seulement si le réseau a échoué à chaque fois.
 */
export async function fetchWithRetry(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit | undefined,
  sleep: SleepLike = defaultSleep,
  delays: readonly number[] = RETRY_DELAYS_MS,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    try {
      const response = await fetchImpl(url, init);
      if (!isTransientStatus(response.status) || attempt === delays.length) return response;
    } catch (error) {
      lastError = error;
      if (attempt === delays.length) throw error;
    }
    await sleep(delays[attempt] ?? 0);
  }
  throw lastError ?? new Error('fetchWithRetry : état impossible');
}
