/** Injection de `fetch` pour tester les sources avec du HTTP simulé. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const defaultFetch: FetchLike = (input, init) => globalThis.fetch(input, init);

/** Extrait lisible du corps d'une réponse d'erreur (HTML ou JSON), tronqué. */
export function errorExcerpt(body: string, max = 200): string {
  const text = body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Attente injectable (limite de débit), remplacée par un no-op dans les tests. */
export type SleepLike = (ms: number) => Promise<void>;

export const defaultSleep: SleepLike = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
