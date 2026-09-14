import { describe, expect, it } from 'vitest';
import { dedupHash, dedupeOffers, offerKey } from '../../src/core/dedup';
import type { JobOffer } from '../../src/core/types';

const offer = (patch: Partial<JobOffer>): JobOffer => ({
  source: 'adzuna',
  externalId: 'a1',
  title: 'Data Analyst',
  company: 'Hôpital Saint-Louis',
  location: 'Paris',
  contractType: 'CDI',
  sector: null,
  nafCode: null,
  salary: null,
  url: 'https://example.test/a1',
  description: '',
  publishedAt: null,
  ...patch,
});

describe('dedupHash', () => {
  it('est un sha256 hexadécimal stable et insensible à la casse / aux accents', async () => {
    const a = await dedupHash('Data Analyst', 'Hôpital Saint-Louis');
    const b = await dedupHash('DATA  ANALYST', 'hopital saint louis');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(b);
  });
});

describe('dedupeOffers', () => {
  it('écarte la même annonce publiée sur deux sources (même empreinte)', async () => {
    const adzuna = offer({});
    const ft = offer({ source: 'francetravail', externalId: 'ft-9', url: 'https://example.test/ft-9' });
    const result = await dedupeOffers([adzuna, ft], { keys: new Set(), hashes: new Set() });
    expect(result.fresh.map((f) => f.offer.source)).toEqual(['adzuna']);
    expect(result.duplicates).toHaveLength(1);
    expect(result.duplicates[0]?.cause).toBe('same_hash');
  });

  it('écarte une offre déjà importée depuis la même source', async () => {
    const known = { keys: new Set([offerKey('adzuna', 'a1')]), hashes: new Set<string>() };
    const result = await dedupeOffers([offer({})], known);
    expect(result.fresh).toHaveLength(0);
    expect(result.duplicates[0]?.cause).toBe('same_source');
  });

  it('écarte une empreinte déjà en base, garde le reste', async () => {
    const existingHash = await dedupHash('Data Analyst', 'Hôpital Saint-Louis');
    const other = offer({ externalId: 'a2', title: 'Data Scientist' });
    const result = await dedupeOffers([offer({}), other], { keys: new Set(), hashes: new Set([existingHash]) });
    expect(result.fresh.map((f) => f.offer.externalId)).toEqual(['a2']);
  });
});
