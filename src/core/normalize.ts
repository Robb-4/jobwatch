/**
 * Normalisation de texte partagée par l'ingestion et l'interface.
 *
 * Toutes les comparaisons du filtrage portent sur du texte normalisé :
 * minuscules, accents retirés, balises HTML supprimées, ponctuation remplacée
 * par des espaces, espaces compressés.
 *
 * Le « + » collé à un chiffre est conservé pour reconnaître « 3+ ans ».
 * Un tiret ou une barre entre deux chiffres (« 3-5 ans », « 3/5 ans ») devient
 * « a » pour que la fourchette reste reconnaissable après suppression de la
 * ponctuation.
 */

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë', agrave: 'à', acirc: 'â',
  ccedil: 'ç', ugrave: 'ù', ucirc: 'û', ocirc: 'ô', icirc: 'î', iuml: 'ï',
  rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”',
  ndash: '–', mdash: '—', hellip: '…', euro: '€',
  laquo: '«', raquo: '»',
};

/** Décode les entités HTML courantes (nommées, décimales, hexadécimales). */
export function decodeEntities(input: string): string {
  return input.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code.startsWith('#')) {
      const hex = code[1]?.toLowerCase() === 'x';
      const num = hex ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      try {
        return Number.isFinite(num) ? String.fromCodePoint(num) : match;
      } catch {
        return match;
      }
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? match;
  });
}

/** Supprime les balises HTML et décode les entités. */
export function stripHtml(input: string): string {
  return decodeEntities(input.replace(/<[^>]*>/g, ' '));
}

/** Texte normalisé : la seule forme sur laquelle les règles travaillent. */
export function normalizeText(input: string | null | undefined): string {
  if (!input) return '';
  return stripHtml(input)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    // « 3-5 ans », « 3/5 ans », « 3–5 ans » → « 3 a 5 ans » (fourchette préservée)
    .replace(/(\d)\s*[-/–]\s*(\d)/g, '$1 a $2')
    // Ponctuation → espace, en conservant lettres, chiffres et « + »
    .replace(/[^\p{L}\p{N}+]+/gu, ' ')
    // Un « + » n'est gardé que collé à un chiffre (« 3+ ») ; « c++ » ou « bac+5 » n'en ont pas besoin
    .replace(/(?<!\p{N})\+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Motif « mots entiers » pour une expression (normalisée à la volée).
 * Le texte normalisé ne contient que des lettres, chiffres, « + » et espaces :
 * une frontière de mot est donc un espace ou une extrémité.
 */
export function phraseRegExp(phrase: string, flags = ''): RegExp | null {
  const normalized = normalizeText(phrase);
  if (!normalized) return null;
  return new RegExp(`(?:^|\\s)${escapeRegExp(normalized)}(?=\\s|$)`, flags);
}

/** Vrai si l'expression apparaît en mots entiers dans un texte déjà normalisé. */
export function containsPhrase(normalizedText: string, phrase: string): boolean {
  const re = phraseRegExp(phrase);
  return re ? re.test(normalizedText) : false;
}

/**
 * Expression de la liste présente dans le texte normalisé, ou null. En cas de
 * plusieurs correspondances, la plus longue l'emporte (« Crédit Agricole »
 * plutôt que « crédit ») : c'est elle qui fait le meilleur détail de rejet.
 */
export function findPhrase(normalizedText: string, phrases: readonly string[]): string | null {
  let best: string | null = null;
  for (const phrase of phrases) {
    if (containsPhrase(normalizedText, phrase) && (best === null || phrase.length > best.length)) {
      best = phrase;
    }
  }
  return best;
}
