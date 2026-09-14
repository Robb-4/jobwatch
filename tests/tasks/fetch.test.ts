import { describe, expect, it } from 'vitest';
import { DEFAULT_FILTER_CONFIG } from '../../src/core/config';
import type { JobOffer, JobSource, SettingRow } from '../../src/core/types';
import { runFetch } from '../../src/tasks/fetch';
import type { FetchRepository, JobOfferInsert, SourceRunInsert } from '../../src/tasks/repository';

/** Dépôt en mémoire : reproduit la contrainte unique et la recherche d'empreintes. */
class MemoryRepository implements FetchRepository {
  offers: JobOfferInsert[] = [];
  runs: SourceRunInsert[] = [];
  settings: SettingRow[] = [];

  async loadSettings() {
    return this.settings;
  }
  async findExistingExternalIds(source: string, ids: readonly string[]) {
    return new Set(
      this.offers.filter((o) => o.source === source && ids.includes(o.external_id)).map((o) => o.external_id),
    );
  }
  async findExistingHashes(hashes: readonly string[]) {
    return new Set(this.offers.filter((o) => hashes.includes(o.dedup_hash)).map((o) => o.dedup_hash));
  }
  async insertOffers(rows: readonly JobOfferInsert[]) {
    this.offers.push(...rows);
  }
  async insertSourceRun(run: SourceRunInsert) {
    this.runs.push(run);
  }
}

const offer = (source: string, externalId: string, patch: Partial<JobOffer> = {}): JobOffer => ({
  source,
  externalId,
  title: 'Data Analyst',
  company: 'CHU de Lyon',
  location: 'Lyon',
  contractType: 'CDI',
  sector: null,
  nafCode: null,
  salary: null,
  url: `https://${source}.test/${externalId}`,
  description: 'Débutant accepté.',
  publishedAt: '2026-09-12T10:00:00Z',
  ...patch,
});

const staticSource = (name: string, offers: JobOffer[]): JobSource => ({
  name,
  label: name,
  fetch: async () => offers,
});

const failingSource: JobSource = {
  name: 'adzuna',
  label: 'Adzuna',
  fetch: async () => {
    throw new Error('Adzuna : HTTP 500 — service indisponible');
  },
};

describe('runFetch', () => {
  it('une source en erreur n’empêche pas l’autre de s’exécuter', async () => {
    const repo = new MemoryRepository();
    const ft = staticSource('francetravail', [offer('francetravail', '1')]);
    const summary = await runFetch({ sources: [failingSource, ft], repo });

    expect(summary.allFailed).toBe(false);
    expect(summary.runs).toHaveLength(2);
    expect(summary.runs[0]).toMatchObject({
      source: 'adzuna',
      succeeded: false,
      error_message: 'Adzuna : HTTP 500 — service indisponible',
    });
    expect(summary.runs[1]).toMatchObject({ source: 'francetravail', succeeded: true, fetched: 1, created: 1 });
    expect(repo.runs).toHaveLength(2);
    expect(repo.offers).toHaveLength(1);
  });

  it('signale un échec global seulement si toutes les sources échouent', async () => {
    const repo = new MemoryRepository();
    const summary = await runFetch({ sources: [failingSource], repo });
    expect(summary.allFailed).toBe(true);
  });

  it('déduplique par empreinte entre deux sources et par clé au sein d’une source', async () => {
    const repo = new MemoryRepository();
    const adzuna = staticSource('adzuna', [offer('adzuna', 'a1'), offer('adzuna', 'a1')]);
    const ft = staticSource('francetravail', [
      offer('francetravail', 'f1'),
      offer('francetravail', 'f2', { title: 'Data Scientist' }),
    ]);
    const summary = await runFetch({ sources: [adzuna, ft], repo, config: DEFAULT_FILTER_CONFIG });

    expect(summary.runs[0]).toMatchObject({ fetched: 2, created: 1, duplicates: 1 });
    // f1 = même titre/entreprise que a1 → doublon ; f2 nouvelle
    expect(summary.runs[1]).toMatchObject({ fetched: 2, created: 1, duplicates: 1 });
    expect(repo.offers.map((o) => `${o.source}:${o.external_id}`)).toEqual(['adzuna:a1', 'francetravail:f2']);

    // Deuxième exécution : tout est déjà connu.
    const again = await runFetch({ sources: [adzuna, ft], repo, config: DEFAULT_FILTER_CONFIG });
    expect(again.runs.map((r) => r.duplicates)).toEqual([2, 2]);
    expect(repo.offers).toHaveLength(2);
  });

  it('stocke les offres rejetées avec leur motif et applique les réglages de la base', async () => {
    const repo = new MemoryRepository();
    repo.settings = [{ key: 'max_experience_years', value: 1 }];
    const source = staticSource('adzuna', [
      offer('adzuna', 'ok'),
      offer('adzuna', 'senior', { title: 'Senior Data Analyst' }),
      offer('adzuna', 'exp', { title: 'Data Engineer', description: '2 ans d’expérience requis' }),
    ]);
    const summary = await runFetch({ sources: [source], repo });
    expect(summary.runs[0]).toMatchObject({ fetched: 3, created: 1, rejected: 2, duplicates: 0 });
    const rejected = repo.offers.filter((o) => o.status === 'rejected');
    expect(rejected.map((o) => [o.rejection_reason, o.rejection_detail])).toEqual([
      ['seniority_title', 'titre: senior'],
      ['experience_too_high', '2 ans'],
    ]);
    expect(repo.offers.find((o) => o.external_id === 'ok')).toMatchObject({ status: 'new', rejection_reason: null });
  });
});
