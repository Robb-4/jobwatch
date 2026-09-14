import type { JobSource } from '../core/types';
import { AdzunaSource } from './adzuna';
import { FranceTravailSource } from './francetravail';

export { AdzunaSource } from './adzuna';
export { FranceTravailSource } from './francetravail';

/**
 * Instancie les sources dont les identifiants sont présents dans l'environnement.
 * Une source sans identifiants est simplement ignorée (et signalée en log).
 */
export function buildSourcesFromEnv(env: NodeJS.ProcessEnv, log: (message: string) => void = () => {}): JobSource[] {
  const sources: JobSource[] = [];

  if (env.ADZUNA_APP_ID && env.ADZUNA_APP_KEY) {
    sources.push(new AdzunaSource({ appId: env.ADZUNA_APP_ID, appKey: env.ADZUNA_APP_KEY }));
  } else {
    log('Adzuna ignoré : ADZUNA_APP_ID / ADZUNA_APP_KEY absents.');
  }

  if (env.FRANCETRAVAIL_CLIENT_ID && env.FRANCETRAVAIL_CLIENT_SECRET) {
    sources.push(
      new FranceTravailSource({
        clientId: env.FRANCETRAVAIL_CLIENT_ID,
        clientSecret: env.FRANCETRAVAIL_CLIENT_SECRET,
      }),
    );
  } else {
    log('France Travail ignoré : FRANCETRAVAIL_CLIENT_ID / FRANCETRAVAIL_CLIENT_SECRET absents.');
  }

  return sources;
}
