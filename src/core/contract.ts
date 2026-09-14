import { normalizeText } from './normalize';

/**
 * Alias de types de contrat → forme canonique.
 * Clés en texte normalisé (minuscules, sans accents). Les codes à trois lettres
 * sont ceux de France Travail, `permanent`/`contract` viennent d'Adzuna.
 * Réglage interne : à modifier ici, pas depuis l'interface.
 */
export const CONTRACT_ALIASES: Record<string, string> = {
  cdi: 'CDI',
  permanent: 'CDI',
  'contrat a duree indeterminee': 'CDI',
  'full time permanent': 'CDI',
  cdd: 'CDD',
  contract: 'CDD',
  temporary: 'CDD',
  'contrat a duree determinee': 'CDD',
  mis: 'Intérim',
  interim: 'Intérim',
  'mission interimaire': 'Intérim',
  sai: 'Saisonnier',
  saisonnier: 'Saisonnier',
  lib: 'Libéral',
  fra: 'Franchise',
  stage: 'Stage',
  internship: 'Stage',
  alternance: 'Alternance',
  apprentissage: 'Alternance',
  'contrat d apprentissage': 'Alternance',
  'contrat de professionnalisation': 'Alternance',
  freelance: 'Freelance',
  independant: 'Freelance',
};

/**
 * Canonise un type de contrat brut. Renvoie null si vide, la valeur brute
 * (nettoyée) si aucun alias ne correspond.
 */
export function normalizeContractType(raw: string | null | undefined): string | null {
  const normalized = normalizeText(raw);
  if (!normalized || !raw) return null;
  return CONTRACT_ALIASES[normalized] ?? raw.trim();
}
