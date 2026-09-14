import type { FilterConfig, SettingRow } from './types';

/**
 * Valeurs livrées des sept critères. La table `settings` ne stocke que les
 * écarts par rapport à ces valeurs : vider la table revient à cette configuration.
 */
export const DEFAULT_FILTER_CONFIG: FilterConfig = {
  acceptedTitles: ['data', 'data analyst', 'data analyste', 'analyste de données', 'data scientist'],
  acceptedContracts: ['CDI'],
  maxExperienceYears: 3,
  seniorityTitleWords: ['senior', 'confirmé', 'confirmée', 'lead', 'principal'],
  // « principal » est volontairement absent : « interlocuteur principal » est courant dans les descriptions.
  seniorityDescriptionWords: ['senior', 'confirmé', 'confirmée', 'lead'],
  financeKeywords: [
    'banque', 'banques', 'bancaire', 'bancaires', 'banking', 'bank',
    'finance', 'financier', 'financiers', 'financière', 'financières', 'financement',
    'assurance', 'assurances', 'assureur', 'assureurs', 'mutuelle', 'mutuelles',
    'crédit', 'crédits', 'courtage', 'courtier', 'courtiers',
    'BNP', 'BNP Paribas', 'Société Générale', 'Crédit Agricole', 'AXA', 'Allianz', 'Generali',
    'MAIF', 'Macif', 'Groupama', 'Natixis', 'Amundi', 'LCL', 'HSBC', 'Boursorama',
    'Crédit Mutuel', 'CIC', 'Banque Populaire', "Caisse d'Épargne", 'BPCE', 'La Banque Postale',
    'CNP Assurances', 'Covéa', 'Matmut', 'Swiss Life', 'Malakoff Humanis', 'AG2R',
  ],
  excludedNafPrefixes: ['64', '65', '66'],
};

/** Clé de la table `settings` pour chaque critère. */
export const SETTING_KEYS: Record<keyof FilterConfig, string> = {
  acceptedTitles: 'accepted_titles',
  acceptedContracts: 'accepted_contracts',
  maxExperienceYears: 'max_experience_years',
  seniorityTitleWords: 'seniority_title_words',
  seniorityDescriptionWords: 'seniority_description_words',
  financeKeywords: 'finance_keywords',
  excludedNafPrefixes: 'excluded_naf_prefixes',
};

export const SETTING_LABELS: Record<keyof FilterConfig, string> = {
  acceptedTitles: 'Intitulés acceptés',
  acceptedContracts: 'Types de contrat acceptés',
  maxExperienceYears: "Seuil d'années d'expérience (maximum exigé toléré)",
  seniorityTitleWords: 'Mots de séniorité (titre)',
  seniorityDescriptionWords: 'Mots de séniorité (description)',
  financeKeywords: 'Mots-clés finance / banque / assurance',
  excludedNafPrefixes: 'Préfixes NAF exclus',
};

export const SETTING_HELP: Record<keyof FilterConfig, string> = {
  acceptedTitles:
    'Une expression par ligne. Le titre doit en contenir au moins une, en mots entiers (« data » ne matche pas « database »).',
  acceptedContracts:
    'Un type par ligne, après canonisation : « permanent » (Adzuna) et « contrat à durée indéterminée » valent « CDI ».',
  maxExperienceYears:
    "Une offre exigeant strictement plus que ce nombre d'années est écartée. Pour une fourchette, la borne basse compte.",
  seniorityTitleWords: 'Un mot par ligne. Présent dans le titre → rejet.',
  seniorityDescriptionWords:
    'Un mot par ligne. Présent dans la description → rejet. Liste séparée du titre pour éviter les faux positifs (« interlocuteur principal »).',
  financeKeywords:
    "Un mot ou une expression par ligne. Cherchés dans le nom de l'entreprise, le secteur et les ~400 premiers caractères de la description. Lister les pluriels.",
  excludedNafPrefixes:
    'Un préfixe par ligne (ex. 64). Sans effet sur Adzuna, qui ne fournit pas de code NAF.',
};

export const CONFIG_FIELDS = Object.keys(SETTING_KEYS) as Array<keyof FilterConfig>;

function fieldForKey(key: string): keyof FilterConfig | null {
  for (const field of CONFIG_FIELDS) {
    if (SETTING_KEYS[field] === key) return field;
  }
  return null;
}

function asStringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

function asNonNegativeNumber(value: unknown): number | null {
  const num = typeof value === 'string' ? Number(value) : value;
  return typeof num === 'number' && Number.isFinite(num) && num >= 0 ? num : null;
}

/**
 * Construit la configuration effective : valeurs par défaut surchargées par les
 * lignes de `settings`. Une valeur mal typée est ignorée (on garde le défaut).
 */
export function resolveFilterConfig(
  rows: readonly SettingRow[],
  defaults: FilterConfig = DEFAULT_FILTER_CONFIG,
): FilterConfig {
  const config: FilterConfig = structuredClone(defaults);
  for (const row of rows) {
    const field = fieldForKey(row.key);
    if (!field) continue;
    if (field === 'maxExperienceYears') {
      const num = asNonNegativeNumber(row.value);
      if (num !== null) config.maxExperienceYears = num;
    } else {
      const list = asStringList(row.value);
      if (list !== null) config[field] = list;
    }
  }
  return config;
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Vrai si le critère a sa valeur livrée. */
export function isDefaultValue(
  field: keyof FilterConfig,
  config: FilterConfig,
  defaults: FilterConfig = DEFAULT_FILTER_CONFIG,
): boolean {
  return sameValue(config[field], defaults[field]);
}

/**
 * Lignes à écrire dans `settings` : uniquement les écarts par rapport aux
 * défauts. Les clés absentes du résultat doivent être supprimées de la table.
 */
export function settingOverrides(
  config: FilterConfig,
  defaults: FilterConfig = DEFAULT_FILTER_CONFIG,
): SettingRow[] {
  const rows: SettingRow[] = [];
  for (const field of CONFIG_FIELDS) {
    if (!sameValue(config[field], defaults[field])) {
      rows.push({ key: SETTING_KEYS[field], value: config[field] });
    }
  }
  return rows;
}
