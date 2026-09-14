import { describe, expect, it } from 'vitest';
import type { MailMessage } from '../../src/tasks/mailer';
import type { JobOfferRow, ReportRepository, SourceRunRow } from '../../src/tasks/repository';
import { buildReport, failingSources, periodFor, runReport, subjectFor } from '../../src/tasks/report';

const offerRow = (id: number, patch: Partial<JobOfferRow> = {}): JobOfferRow => ({
  id,
  source: 'adzuna',
  external_id: String(id),
  title: `Data Analyst <${id}>`,
  company: 'CHU',
  location: 'Paris',
  contract_type: 'CDI',
  sector: null,
  naf_code: null,
  salary: null,
  url: `https://a.test/${id}`,
  description: '',
  published_at: '2026-09-12T10:00:00Z',
  dedup_hash: 'h',
  status: 'new',
  rejection_reason: null,
  rejection_detail: null,
  personal_status: null,
  note: null,
  created_at: '2026-09-12T11:00:00Z',
  updated_at: '2026-09-12T11:00:00Z',
  reported_at: null,
  ...patch,
});

const runRow = (id: number, patch: Partial<SourceRunRow> = {}): SourceRunRow => ({
  id,
  source: 'adzuna',
  label: 'Adzuna',
  succeeded: true,
  fetched: 10,
  created: 2,
  rejected: 6,
  duplicates: 2,
  error_message: null,
  created_at: `2026-09-12T0${id}:00:00Z`,
  reported_at: null,
  ...patch,
});

describe('objet et période', () => {
  it('accorde le pluriel et gère l’absence d’offre', () => {
    expect(subjectFor(0, 'matin')).toBe('JobWatch — aucune nouvelle offre (matin)');
    expect(subjectFor(1, 'soir')).toBe('JobWatch — 1 nouvelle offre (soir)');
    expect(subjectFor(3, 'matin')).toBe('JobWatch — 3 nouvelles offres (matin)');
  });

  it('déduit matin / soir de l’heure de Paris', () => {
    expect(periodFor(new Date('2026-01-15T06:30:00Z'))).toBe('matin'); // 07:30 Paris (hiver)
    expect(periodFor(new Date('2026-07-15T17:30:00Z'))).toBe('soir'); // 19:30 Paris (été)
  });
});

describe('failingSources', () => {
  it('ne signale que les sources encore en panne au dernier essai', () => {
    const runs = [
      runRow(1, { succeeded: false, error_message: 'HTTP 500' }),
      runRow(2), // Adzuna rétablie
      runRow(3, { source: 'francetravail', label: 'France Travail', succeeded: false, error_message: 'HTTP 401' }),
    ];
    expect(failingSources(runs).map((r) => r.source)).toEqual(['francetravail']);
  });
});

describe('buildReport', () => {
  it('contient le tableau, l’encart d’erreur et les compteurs agrégés', () => {
    const offers = [offerRow(1, { salary: '40 000 €' })];
    const runs = [
      runRow(1),
      runRow(2, {
        source: 'francetravail',
        label: 'France Travail',
        succeeded: false,
        error_message: 'HTTP 401',
        fetched: 0,
        rejected: 0,
        duplicates: 0,
      }),
    ];
    const report = buildReport(offers, runs, 'matin');
    expect(report.subject).toBe('JobWatch — 1 nouvelle offre (matin)');
    expect(report.html).toContain('<a href="https://a.test/1">Data Analyst &lt;1&gt;</a>');
    expect(report.html).toContain('40 000 €');
    expect(report.html).toContain('France Travail');
    expect(report.html).toContain('HTTP 401');
    expect(report.html).toContain('<strong>10</strong> récupérée(s)');
    expect(report.html).toContain('<strong>6</strong> écartée(s)');
    expect(report.html).toContain('<strong>2</strong> doublon(s)');
    expect(report.text).toContain('https://a.test/1');
  });

  it('est envoyé même sans offre (preuve de vie)', () => {
    const report = buildReport([], [], 'soir');
    expect(report.subject).toContain('aucune nouvelle offre');
    expect(report.html).toContain('Aucune nouvelle offre');
  });
});

class MemoryReportRepository implements ReportRepository {
  reportedOffers: number[] = [];
  reportedRuns: number[] = [];
  constructor(
    private offers: JobOfferRow[],
    private runs: SourceRunRow[],
  ) {}
  async loadNewOffers() {
    return this.offers;
  }
  async loadUnreportedRuns() {
    return this.runs;
  }
  async markOffersReported(ids: readonly number[]) {
    this.reportedOffers.push(...ids);
  }
  async markRunsReported(ids: readonly number[]) {
    this.reportedRuns.push(...ids);
  }
}

describe('runReport', () => {
  it('marque les offres et exécutions seulement après un envoi réussi', async () => {
    const repo = new MemoryReportRepository([offerRow(1), offerRow(2)], [runRow(1)]);
    const sent: MailMessage[] = [];
    await runReport({
      repo,
      mailer: { send: async (m) => void sent.push(m) },
      from: 'a@x',
      to: 'b@x',
      period: 'matin',
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.subject).toBe('JobWatch — 2 nouvelles offres (matin)');
    expect(repo.reportedOffers).toEqual([1, 2]);
    expect(repo.reportedRuns).toEqual([1]);
  });

  it('ne marque rien si l’envoi SMTP échoue', async () => {
    const repo = new MemoryReportRepository([offerRow(1)], [runRow(1)]);
    const mailer = {
      send: async () => {
        throw new Error('SMTP indisponible');
      },
    };
    await expect(runReport({ repo, mailer, from: 'a@x', to: 'b@x' })).rejects.toThrow('SMTP indisponible');
    expect(repo.reportedOffers).toEqual([]);
    expect(repo.reportedRuns).toEqual([]);
  });
});
