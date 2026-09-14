import { describe, expect, it } from 'vitest';
import { FranceTravailSource } from '../../src/sources/francetravail';
import type { FetchLike } from '../../src/sources/http';

interface Call {
  url: URL;
  init: RequestInit | undefined;
}

function offer(id: string, patch: Record<string, unknown> = {}) {
  return {
    id,
    intitule: `Analyste données ${id}`,
    entreprise: { nom: 'CHU' },
    lieuTravail: { libelle: '75 - PARIS' },
    typeContrat: 'CDI',
    codeNAF: '8610Z',
    secteurActivite: '86',
    secteurActiviteLibelle: 'Activités hospitalières',
    salaire: { libelle: 'Annuel de 32000 à 38000 Euros' },
    origineOffre: { urlOrigine: `https://ft.test/${id}` },
    description: 'Description',
    dateCreation: '2026-09-11T09:30:00.000Z',
    ...patch,
  };
}

function setup(search: (url: URL, call: number) => Response, tokenTtl = 1499) {
  const calls: Call[] = [];
  let searchCalls = 0;
  const fetchImpl: FetchLike = async (input, init) => {
    const url = new URL(input);
    calls.push({ url, init });
    if (url.pathname.includes('access_token')) {
      return new Response(JSON.stringify({ access_token: `tok-${calls.length}`, expires_in: tokenTtl }), { status: 200 });
    }
    searchCalls += 1;
    return search(url, searchCalls);
  };
  let now = 1_000_000;
  const source = new FranceTravailSource({
    clientId: 'id',
    clientSecret: 'secret',
    fetchImpl,
    sleep: async () => {},
    now: () => now,
  });
  return { source, calls, advance: (ms: number) => (now += ms) };
}

const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status });

describe('FranceTravailSource — authentification', () => {
  it('obtient un jeton client_credentials avec le bon scope et le met en cache', async () => {
    const { source, calls, advance } = setup(() => json({ resultats: [offer('1')] }, 200));
    await source.fetch();
    await source.fetch();
    const tokenCalls = calls.filter((c) => c.url.pathname.includes('access_token'));
    expect(tokenCalls).toHaveLength(1);
    expect(tokenCalls[0]?.url.searchParams.get('realm')).toBe('/partenaire');
    const body = new URLSearchParams(String(tokenCalls[0]?.init?.body));
    expect(body.get('grant_type')).toBe('client_credentials');
    expect(body.get('scope')).toBe('api_offresdemploiv2 o2dsoffre');

    // Expiration moins la marge : le jeton est renouvelé.
    advance(1_499_000);
    await source.fetch();
    expect(calls.filter((c) => c.url.pathname.includes('access_token'))).toHaveLength(2);
  });

  it('lève une erreur lisible si l’authentification est refusée', async () => {
    const fetchImpl: FetchLike = async () => new Response('{"error":"invalid_client"}', { status: 401 });
    const source = new FranceTravailSource({ clientId: 'id', clientSecret: 'bad', fetchImpl });
    await expect(source.fetch()).rejects.toThrow(/authentification refusée \(HTTP 401\)/);
  });
});

describe('FranceTravailSource — recherche et pagination', () => {
  it('envoie les paramètres attendus et le jeton Bearer', async () => {
    const { source, calls } = setup(() => json({ resultats: [] }, 200));
    await source.fetch();
    const search = calls.find((c) => c.url.pathname.endsWith('/offres/search'))!;
    expect(search.url.searchParams.get('motsCles')).toBe('data');
    expect(search.url.searchParams.get('typeContrat')).toBe('CDI');
    expect(search.url.searchParams.get('experience')).toBe('1,2');
    expect(search.url.searchParams.get('publieeDepuis')).toBe('7');
    expect(search.url.searchParams.get('range')).toBe('0-149');
    expect((search.init?.headers as Record<string, string>).Authorization).toMatch(/^Bearer tok-/);
  });

  it('continue sur 206, s’arrête sur 200, et traite 400 hors volume comme une fin', async () => {
    const { source, calls } = setup((url, n) => {
      if (n === 1) return json({ resultats: [offer('1')] }, 206);
      if (n === 2) return json({ resultats: [offer('2')] }, 206);
      return new Response('range hors limites', { status: 400 });
    });
    const offers = await source.fetch();
    const ranges = calls.filter((c) => c.url.pathname.endsWith('/search')).map((c) => c.url.searchParams.get('range'));
    expect(ranges).toEqual(['0-149', '150-299', '300-449']);
    expect(offers.map((o) => o.externalId)).toEqual(['1', '2']);
  });

  it('s’arrête sur 204', async () => {
    const { source, calls } = setup(() => new Response(null, { status: 204 }));
    expect(await source.fetch()).toEqual([]);
    expect(calls.filter((c) => c.url.pathname.endsWith('/search'))).toHaveLength(1);
  });

  it('lève une erreur lisible sur un 400 en première page (vraie erreur)', async () => {
    const { source } = setup(() => new Response('paramètre invalide', { status: 400 }));
    await expect(source.fetch()).rejects.toThrow(/HTTP 400 .* paramètre invalide/);
  });

  it('normalise une offre avec son code NAF', async () => {
    const { source } = setup(() => json({ resultats: [offer('42')] }, 200));
    const [o] = await source.fetch();
    expect(o).toEqual({
      source: 'francetravail',
      externalId: '42',
      title: 'Analyste données 42',
      company: 'CHU',
      location: '75 - PARIS',
      contractType: 'CDI',
      sector: 'Activités hospitalières',
      nafCode: '8610Z',
      salary: 'Annuel de 32000 à 38000 Euros',
      url: 'https://ft.test/42',
      description: 'Description',
      publishedAt: '2026-09-11T09:30:00.000Z',
    });
  });
});
