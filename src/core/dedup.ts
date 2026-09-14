import { normalizeText } from './normalize';
import type { JobOffer } from './types';

/**
 * Déduplication : empreinte sha256(titre normalisé + '|' + entreprise normalisée).
 * Repère la même annonce publiée sur deux sources différentes.
 * Web Crypto est disponible dans Node 20+ et dans tous les navigateurs.
 */

export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Texte haché pour l'empreinte. */
export function dedupKey(title: string, company: string | null | undefined): string {
  return `${normalizeText(title)}|${normalizeText(company)}`;
}

export function dedupHash(title: string, company: string | null | undefined): Promise<string> {
  return sha256Hex(dedupKey(title, company));
}

/** Clé d'unicité d'une offre chez sa source. */
export function offerKey(source: string, externalId: string): string {
  return `${source}:${externalId}`;
}

export interface HashedOffer {
  offer: JobOffer;
  hash: string;
}

export type DuplicateCause = 'same_source' | 'same_hash';

export interface DedupResult {
  fresh: HashedOffer[];
  duplicates: Array<HashedOffer & { cause: DuplicateCause }>;
}

export interface KnownOffers {
  /** Clés `source:externalId` déjà importées. */
  keys: ReadonlySet<string>;
  /** Empreintes déjà présentes, toutes sources confondues. */
  hashes: ReadonlySet<string>;
}

/**
 * Sépare les offres nouvelles des doublons : déjà importée depuis la même
 * source (clé), ou même empreinte (autre source, ou doublon dans le lot).
 */
export async function dedupeOffers(offers: readonly JobOffer[], known: KnownOffers): Promise<DedupResult> {
  const seenKeys = new Set<string>(known.keys);
  const seenHashes = new Set<string>(known.hashes);
  const result: DedupResult = { fresh: [], duplicates: [] };

  for (const offer of offers) {
    const hash = await dedupHash(offer.title, offer.company);
    const key = offerKey(offer.source, offer.externalId);
    if (seenKeys.has(key)) {
      result.duplicates.push({ offer, hash, cause: 'same_source' });
      continue;
    }
    if (seenHashes.has(hash)) {
      result.duplicates.push({ offer, hash, cause: 'same_hash' });
      continue;
    }
    seenKeys.add(key);
    seenHashes.add(hash);
    result.fresh.push({ offer, hash });
  }
  return result;
}
