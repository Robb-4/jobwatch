/**
 * Sonde France Travail : premier appel réel pour vérifier l'authentification et
 * le comportement de `motsCles` (titre seul ou texte entier ?).
 *
 *   npx tsx scripts/probe-francetravail.ts [motsCles ...]
 *
 * N'écrit rien en base. Identifiants lus dans `.env`.
 */
import 'dotenv/config';
import { FranceTravailSource } from '../src/sources/francetravail';

const searches = process.argv.slice(2);
if (searches.length === 0) searches.push('data', 'data analyst');

const clientId = process.env.FRANCETRAVAIL_CLIENT_ID;
const clientSecret = process.env.FRANCETRAVAIL_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error('FRANCETRAVAIL_CLIENT_ID / FRANCETRAVAIL_CLIENT_SECRET manquants dans .env');
  process.exit(1);
}

const source = new FranceTravailSource({ clientId, clientSecret, maxPages: 1 });
const token = await source.getToken();
console.log(`Jeton OK (${token.length} caractères)`);

for (const mots of searches) {
  const url = source.buildSearchUrl(mots, 0);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  console.log(`\n=== motsCles=« ${mots} » → HTTP ${res.status} ; Content-Range : ${res.headers.get('content-range') ?? 'absent'}`);
  const body = await res.text();
  let json: { resultats?: Array<Record<string, any>> } = {};
  try {
    json = JSON.parse(body) as typeof json;
  } catch {
    console.log('Corps non JSON :', body.slice(0, 300));
    continue;
  }
  const offres = json.resultats ?? [];
  const inTitle = offres.filter((o) => new RegExp(`\\b${mots.split(' ')[0]}\\b`, 'i').test(String(o.intitule)));
  console.log(`${offres.length} résultat(s) ; titres contenant « ${mots.split(' ')[0]} » : ${inTitle.length}`);
  for (const o of offres.slice(0, 15)) {
    console.log(
      `  - ${o.intitule} | ${o.entreprise?.nom ?? '?'} | ${o.lieuTravail?.libelle ?? '?'} | ${o.typeContrat} | ${o.experienceLibelle ?? ''} | NAF ${o.codeNAF ?? o.secteurActivite ?? '?'}`,
    );
  }
  if (offres[0]) console.log('Champs :', Object.keys(offres[0]).join(', '));
}
