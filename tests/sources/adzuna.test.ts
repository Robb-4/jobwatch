import { describe, expect, it } from 'vitest';
import { AdzunaSource, formatAdzunaSalary } from '../../src/sources/adzuna';
import type { FetchLike } from '../../src/sources/http';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function result(id: number, patch: Record<string, unknown> = {}) {
  return {
    id,
    title: `Data Analyst ${id}`,
    company: { display_name: 'Entreprise' },
    location: { display_name: 'Paris' },
    contract_type: 'permanent',
    category: { label: 'IT Jobs' },
    redirect_url: `https://adzuna.test/${id}`,
    description: 'Description',
    created: '2026-09-10T08:00:00Z',
    ...patch,
  };
}

function recordingFetch(handler: (url: URL) => Response): { fetchImpl: FetchLike; urls: URL[] } {
  const urls: URL[] = [];
  const fetchImpl: FetchLike = async (input) => {
    const url = new URL(input);
    urls.push(url);
    return handler(url);
  };
  return { fetchImpl, urls };
}

const credentials = { appId: '12345678', appKey: 'k'.repeat(32) };

describe('AdzunaSource — non-régressions sur la requête', () => {
  it('demande le CDI par permanent=1 et jamais par contract_type', async () => {
    const { fetchImpl, urls } = recordingFetch(() => jsonResponse({ count: 0, results: [] }));
    await new AdzunaSource({ ...credentials, fetchImpl }).fetch();
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(url.searchParams.get('permanent')).toBe('1');
      expect(url.searchParams.has('contract_type')).toBe(false);
    }
  });

  it('cherche dans le titre seul avec title_only, jamais what_or', async () => {
    const { fetchImpl, urls } = recordingFetch(() => jsonResponse({ count: 0, results: [] }));
    await new AdzunaSource({ ...credentials, fetchImpl }).fetch();
    for (const url of urls) {
      expect(url.searchParams.get('title_only')).toBeTruthy();
      expect(url.searchParams.has('what_or')).toBe(false);
      expect(url.searchParams.has('what')).toBe(false);
    }
  });

  it('enchaîne les recherches par défaut, avec les paramètres attendus, pages à partir de 1', async () => {
    const { fetchImpl, urls } = recordingFetch(() => jsonResponse({ count: 0, results: [] }));
    await new AdzunaSource({ ...credentials, fetchImpl }).fetch();
    expect(urls.map((u) => u.searchParams.get('title_only'))).toEqual(['data', 'analyste données']);
    const first = urls[0]!;
    expect(first.pathname).toBe('/v1/api/jobs/fr/search/1');
    expect(first.searchParams.get('app_id')).toBe(credentials.appId);
    expect(first.searchParams.get('app_key')).toBe(credentials.appKey);
    expect(first.searchParams.get('content-type')).toBe('application/json');
    expect(first.searchParams.get('results_per_page')).toBe('50');
    expect(first.searchParams.get('sort_by')).toBe('date');
    expect(first.searchParams.get('max_days_old')).toBe('7');
    expect(first.searchParams.get('what_exclude')).toBe('banque finance banking assurance');
  });
});

describe('AdzunaSource — pagination et normalisation', () => {
  it('pagine tant que la page est pleine, s’arrête sur une page incomplète et fusionne les doublons', async () => {
    const { fetchImpl, urls } = recordingFetch((url) => {
      const page = Number(url.pathname.split('/').pop());
      if (page === 1) return jsonResponse({ results: [result(1), result(2)] });
      return jsonResponse({ results: [result(2)] });
    });
    const source = new AdzunaSource({
      ...credentials,
      fetchImpl,
      resultsPerPage: 2,
      maxPages: 5,
      searches: [{ title_only: 'data' }],
    });
    const offers = await source.fetch();
    expect(urls.map((u) => u.pathname.split('/').pop())).toEqual(['1', '2']);
    expect(offers.map((o) => o.externalId)).toEqual(['1', '2']);
  });

  it('plafonne le nombre de pages', async () => {
    const { fetchImpl, urls } = recordingFetch(() => jsonResponse({ results: [result(1), result(2)] }));
    await new AdzunaSource({ ...credentials, fetchImpl, resultsPerPage: 2, maxPages: 3, searches: [{ title_only: 'x' }] }).fetch();
    expect(urls).toHaveLength(3);
  });

  it('normalise une offre : permanent → CDI, pas de NAF, salaire estimé ignoré', async () => {
    const { fetchImpl } = recordingFetch(() =>
      jsonResponse({
        results: [
          result(1, { salary_min: 35000, salary_max: 42000, salary_is_predicted: '0' }),
          result(2, { salary_min: 35000, salary_max: 42000, salary_is_predicted: '1' }),
        ],
      }),
    );
    const [a, b] = await new AdzunaSource({ ...credentials, fetchImpl, searches: [{ title_only: 'data' }] }).fetch();
    expect(a).toMatchObject({
      source: 'adzuna',
      externalId: '1',
      contractType: 'CDI',
      nafCode: null,
      sector: 'IT Jobs',
      url: 'https://adzuna.test/1',
      publishedAt: '2026-09-10T08:00:00Z',
    });
    expect(a?.salary).toMatch(/35.000 – 42.000 €/);
    expect(b?.salary).toBeNull();
    expect(formatAdzunaSalary({ id: 1 })).toBeNull();
  });

  it('lève une erreur lisible sur un 400 HTML', async () => {
    const { fetchImpl } = recordingFetch(
      () => new Response('<html><body><h1>Bad Request</h1></body></html>', { status: 400 }),
    );
    await expect(new AdzunaSource({ ...credentials, fetchImpl }).fetch()).rejects.toThrow(
      /Adzuna : HTTP 400 pour « data » page 1 — Bad Request/,
    );
  });

  it('refuse de démarrer sans identifiants', () => {
    expect(() => new AdzunaSource({ appId: '', appKey: '' })).toThrow(/ADZUNA_APP_ID/);
  });
});
