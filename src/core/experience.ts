import { containsPhrase } from './normalize';

/**
 * Détection d'une exigence d'expérience explicite (« 5 ans minimum »,
 * « 3+ ans », « expérience de trois à six ans », « 5 years of experience »).
 *
 * Réglages internes, commentés sur place : ils demandent de comprendre la
 * mécanique de détection et ne sont pas exposés dans l'interface.
 */

/** Nombres en toutes lettres reconnus (français et anglais), en texte normalisé. */
export const NUMBER_WORDS: Record<string, number> = {
  un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10,
  one: 1, two: 2, three: 3, four: 4, five: 5, seven: 7, eight: 8, nine: 9, ten: 10,
};

/**
 * Mots de contexte : « N ans » n'est une exigence que si l'un d'eux apparaît à
 * proximité. Sans ce garde-fou, « société créée il y a 12 ans » écarterait l'offre.
 */
export const EXPERIENCE_CONTEXT_WORDS: readonly string[] = [
  'experience', 'experiences', 'experienced', 'exp',
  'minimum', 'mini', 'au moins', 'a minima', 'au minimum',
  'requis', 'requise', 'requises', 'required',
  'exige', 'exigee', 'exigees', 'exigence',
  'souhaite', 'souhaitee', 'souhaitees',
  'justifiant', 'justifier', 'justifiez', 'justifie',
  'anciennete', 'pratique', 'exercice', 'background', 'seniority',
];

/** Fenêtre (en caractères) de part et d'autre de « N ans » où chercher un mot de contexte. */
export const EXPERIENCE_CONTEXT_WINDOW = 80;

/**
 * Au-delà, « N ans » n'est pas une exigence d'expérience mais l'ancienneté
 * d'une société (« 30 ans d'expérience à votre service »), même avec un mot
 * de contexte à proximité. Observé sur une vraie récolte Adzuna.
 */
export const EXPERIENCE_MAX_PLAUSIBLE_YEARS = 20;

/**
 * Mots précédant immédiatement « N ans » qui en font un plafond, pas un
 * minimum (« moins de 5 ans d'expérience » ne rejette pas).
 */
export const EXPERIENCE_CEILING_WORDS: readonly string[] = [
  'moins de', 'maximum', 'max', 'jusqu a', 'up to', 'inferieur a', 'inferieure a', 'less than',
];

const NUM = `(?:\\d{1,2}|${Object.keys(NUMBER_WORDS).join('|')})`;
const UNIT = `(?:ans?|annees?|years?|yrs?)`;
const RANGE_LINK = `(?:a|et|ou|to|and|or)`;

/**
 * « N[+] [lien M] unité [lien M unité] », en texte normalisé.
 * Groupes : 1 = N, 2 = « + », 3 = M (« 3 à 6 ans »), 4 = M (« 3 ans à 6 ans »).
 */
const EXPERIENCE_RE = new RegExp(
  `(?:^|\\s)(${NUM})(\\+)?(?:\\s+${RANGE_LINK}\\s+(${NUM}))?\\s+${UNIT}(?:\\s+${RANGE_LINK}\\s+(${NUM})\\s+${UNIT})?(?=\\s|$)`,
  'g',
);

function toNumber(token: string): number | null {
  if (/^\d+$/.test(token)) return Number(token);
  return NUMBER_WORDS[token] ?? null;
}

export interface ExperienceRequirement {
  /** Années exigées (borne basse pour une fourchette). */
  years: number;
  /** Extrait déclencheur, ex. « 5 ans » ou « 3 a 6 ans ». */
  snippet: string;
}

export interface ExperienceDetectionOptions {
  contextWords?: readonly string[];
  contextWindow?: number;
  ceilingWords?: readonly string[];
}

/** Toutes les exigences détectées dans un texte normalisé. */
export function detectExperienceRequirements(
  normalizedText: string,
  options: ExperienceDetectionOptions = {},
): ExperienceRequirement[] {
  const contextWords = options.contextWords ?? EXPERIENCE_CONTEXT_WORDS;
  const window = options.contextWindow ?? EXPERIENCE_CONTEXT_WINDOW;
  const ceilingWords = options.ceilingWords ?? EXPERIENCE_CEILING_WORDS;
  const found: ExperienceRequirement[] = [];

  EXPERIENCE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = EXPERIENCE_RE.exec(normalizedText)) !== null) {
    const raw = match[0];
    const leading = raw.length - raw.trimStart().length;
    const start = match.index + leading;
    const end = match.index + raw.length;
    const snippet = raw.trim();

    const low = toNumber(match[1] ?? '');
    if (low === null) continue;
    const highToken = match[3] ?? match[4];
    const high = highToken ? toNumber(highToken) : null;
    // Fourchette : la borne basse est le minimum réellement exigé.
    const years = high !== null ? Math.min(low, high) : low;
    if (years > EXPERIENCE_MAX_PLAUSIBLE_YEARS) continue;

    // Plafond (« moins de 5 ans ») : pas une exigence minimale.
    const before = normalizedText.slice(Math.max(0, start - 20), start);
    if (ceilingWords.some((w) => containsPhrase(before, w))) continue;

    // Mot de contexte à proximité, sinon « 12 ans » peut désigner l'âge de la société.
    const around = normalizedText.slice(
      Math.max(0, start - window),
      Math.min(normalizedText.length, end + window),
    );
    if (!contextWords.some((w) => containsPhrase(around, w))) continue;

    found.push({ years, snippet });
  }
  return found;
}

/** L'exigence la plus élevée du texte, ou null si aucune. */
export function detectMaxExperienceRequirement(
  normalizedText: string,
  options: ExperienceDetectionOptions = {},
): ExperienceRequirement | null {
  let best: ExperienceRequirement | null = null;
  for (const req of detectExperienceRequirements(normalizedText, options)) {
    if (!best || req.years > best.years) best = req;
  }
  return best;
}
