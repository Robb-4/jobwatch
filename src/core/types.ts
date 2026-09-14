/**
 * Types partagés entre le script d'ingestion (GitHub Actions) et l'interface web.
 * Aucune dépendance à Supabase ni au DOM ici.
 */

/** Offre normalisée, indépendante de la source. */
export interface JobOffer {
  /** Clé technique de la source, ex. 'adzuna'. */
  source: string;
  /** Identifiant de l'offre chez la source. */
  externalId: string;
  title: string;
  company: string | null;
  location: string | null;
  /** Type de contrat déjà canonisé par `normalizeContractType` ('CDI', 'CDD'…). */
  contractType: string | null;
  /** Secteur d'activité en clair, tel que déclaré par la source. */
  sector: string | null;
  /** Code NAF/APE (ex. '6201Z' ou '62'). Adzuna ne le fournit pas. */
  nafCode: string | null;
  /** Salaire affichable, ou null si absent ou estimé. */
  salary: string | null;
  url: string;
  description: string;
  /** Date de publication ISO 8601, ou null. */
  publishedAt: string | null;
}

/** Contrat commun à toutes les sources : récupérer et normaliser, rien d'autre. */
export interface JobSource {
  /** Clé technique, ex. 'adzuna'. */
  readonly name: string;
  /** Libellé humain, repris dans le rapport. */
  readonly label: string;
  /** Lève une erreur explicite et lisible en cas d'échec : ce message finit en tête du rapport mail. */
  fetch(): Promise<JobOffer[]>;
}

/** Codes stables de rejet, utilisés pour compter par motif. */
export type RejectionReason =
  | 'title_not_matching'
  | 'title_excluded'
  | 'location_not_matching'
  | 'finance_naf'
  | 'finance_keyword'
  | 'contract_type'
  | 'seniority_title'
  | 'seniority_description'
  | 'experience_too_high';

export const REJECTION_REASON_LABELS: Record<RejectionReason, string> = {
  title_not_matching: 'Intitulé hors cible',
  title_excluded: 'Intitulé exclu (ex. data center)',
  location_not_matching: 'Lieu hors zone',
  finance_naf: 'Secteur finance (code NAF)',
  finance_keyword: 'Secteur finance (mot-clé)',
  contract_type: 'Type de contrat',
  seniority_title: 'Séniorité dans le titre',
  seniority_description: 'Séniorité dans la description',
  experience_too_high: 'Expérience exigée trop élevée',
};

/** Identifiant des règles, dans leur ordre d'évaluation. */
export type RuleId = 'title' | 'location' | 'finance' | 'contract' | 'experience';

export const RULE_LABELS: Record<RuleId, string> = {
  title: '1. Intitulé',
  location: '2. Lieu',
  finance: '3. Secteur finance / banque / assurance',
  contract: '4. Type de contrat',
  experience: '5. Expérience',
};

/** Les critères modifiables depuis l'interface. */
export interface FilterConfig {
  /** Le titre doit contenir au moins une de ces expressions (mots entiers). */
  acceptedTitles: string[];
  /** Expressions qui écartent une offre dès le titre (« data center »). */
  excludedTitleWords: string[];
  /** Le lieu doit contenir une de ces expressions ; liste vide = toute la France. */
  acceptedLocations: string[];
  /** Types de contrat acceptés, après canonisation ('CDI'). */
  acceptedContracts: string[];
  /** Exigence d'expérience maximale tolérée, en années (inclus). */
  maxExperienceYears: number;
  /** Mots de séniorité rejetés dans le titre. */
  seniorityTitleWords: string[];
  /** Mots de séniorité rejetés dans la description (liste séparée : « principal » y fait des faux positifs). */
  seniorityDescriptionWords: string[];
  /** Mots-clés finance cherchés dans l'entreprise, le secteur et le début de la description. */
  financeKeywords: string[];
  /** Préfixes de code NAF exclus. */
  excludedNafPrefixes: string[];
}

/** Sous-ensemble d'une offre nécessaire au filtrage (le testeur n'a ni URL ni identifiant). */
export type FilterableOffer = Pick<
  JobOffer,
  'title' | 'company' | 'location' | 'sector' | 'nafCode' | 'contractType' | 'description'
>;

export type FilterDecision =
  | { accepted: true }
  | { accepted: false; reason: RejectionReason; detail: string };

/** Résultat détaillé d'une règle, pour le testeur de l'interface. */
export interface RuleOutcome {
  rule: RuleId;
  label: string;
  passed: boolean;
  reason?: RejectionReason;
  /** Élément déclencheur exact : « titre: lead », « NAF 6419Z », « 5 ans ». */
  detail?: string;
}

/** Ligne de la table `settings` : clé → valeur JSON. */
export interface SettingRow {
  key: string;
  value: unknown;
}
