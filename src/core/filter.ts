import { DEFAULT_FILTER_CONFIG } from './config';
import { normalizeContractType } from './contract';
import { detectMaxExperienceRequirement } from './experience';
import { findPhrase, normalizeText } from './normalize';
import {
  RULE_LABELS,
  type FilterConfig,
  type FilterDecision,
  type FilterableOffer,
  type RejectionReason,
  type RuleId,
  type RuleOutcome,
} from './types';

/**
 * Les règles de filtrage, évaluées en séquence. La première qui échoue
 * donne le motif de rejet. Ce module est partagé à l'identique par le script
 * d'ingestion et le testeur de l'interface.
 */

/** Longueur de description inspectée pour les mots-clés finance. */
export const FINANCE_DESCRIPTION_HEAD = 400;

type RuleFn = (offer: FilterableOffer, config: FilterConfig) => RuleOutcome;

const pass = (rule: RuleId): RuleOutcome => ({ rule, label: RULE_LABELS[rule], passed: true });
const fail = (rule: RuleId, reason: RejectionReason, detail: string): RuleOutcome => ({
  rule,
  label: RULE_LABELS[rule],
  passed: false,
  reason,
  detail,
});

/**
 * 1. Le titre ne doit contenir aucune expression exclue (« data center ») et doit
 * contenir au moins une expression acceptée (mots entiers).
 */
const titleRule: RuleFn = (offer, config) => {
  const title = normalizeText(offer.title);
  const excluded = findPhrase(title, config.excludedTitleWords);
  if (excluded) return fail('title', 'title_excluded', `titre: ${excluded}`);
  const hit = findPhrase(title, config.acceptedTitles);
  return hit
    ? pass('title')
    : fail('title', 'title_not_matching', 'aucune expression acceptée dans le titre');
};

/**
 * 2. Lieu : le lieu doit contenir une expression acceptée. Liste vide = pas de
 * filtre. Un lieu absent passe : on ne peut pas prouver qu'il est hors zone.
 */
const locationRule: RuleFn = (offer, config) => {
  if (config.acceptedLocations.length === 0) return pass('location');
  const location = normalizeText(offer.location);
  if (!location) return pass('location');
  const hit = findPhrase(location, config.acceptedLocations);
  return hit ? pass('location') : fail('location', 'location_not_matching', `lieu: ${offer.location}`);
};

/** 3. Secteur finance / banque / assurance : code NAF, puis mots-clés. */
const financeRule: RuleFn = (offer, config) => {
  const naf = (offer.nafCode ?? '').trim().toUpperCase();
  if (naf) {
    const prefix = config.excludedNafPrefixes.find((p) => p && naf.startsWith(p.trim().toUpperCase()));
    if (prefix) return fail('finance', 'finance_naf', `NAF ${naf}`);
  }

  const company = normalizeText(offer.company);
  const companyHit = findPhrase(company, config.financeKeywords);
  if (companyHit) return fail('finance', 'finance_keyword', `entreprise: ${companyHit}`);

  const sector = normalizeText(offer.sector);
  const sectorHit = findPhrase(sector, config.financeKeywords);
  if (sectorHit) return fail('finance', 'finance_keyword', `secteur: ${sectorHit}`);

  const head = normalizeText(offer.description).slice(0, FINANCE_DESCRIPTION_HEAD);
  const descriptionHit = findPhrase(head, config.financeKeywords);
  if (descriptionHit) return fail('finance', 'finance_keyword', `description: ${descriptionHit}`);

  return pass('finance');
};

/**
 * 4. Type de contrat. Déjà filtré côté API, revérifié ici. Une valeur absente
 * n'est pas rejetée : on ne peut pas prouver qu'elle n'est pas un CDI.
 */
const contractRule: RuleFn = (offer, config) => {
  const contract = normalizeContractType(offer.contractType);
  if (contract === null) return pass('contract');
  const accepted = config.acceptedContracts.map((c) => normalizeText(normalizeContractType(c) ?? c));
  return accepted.includes(normalizeText(contract))
    ? pass('contract')
    : fail('contract', 'contract_type', `contrat: ${contract}`);
};

/** 5. Expérience : mots de séniorité (titre, puis description), puis exigence explicite. */
const experienceRule: RuleFn = (offer, config) => {
  const title = normalizeText(offer.title);
  const titleHit = findPhrase(title, config.seniorityTitleWords);
  if (titleHit) return fail('experience', 'seniority_title', `titre: ${titleHit}`);

  const description = normalizeText(offer.description);
  const descriptionHit = findPhrase(description, config.seniorityDescriptionWords);
  if (descriptionHit) return fail('experience', 'seniority_description', `description: ${descriptionHit}`);

  const requirement = detectMaxExperienceRequirement(`${title} ${description}`);
  if (requirement && requirement.years > config.maxExperienceYears) {
    return fail('experience', 'experience_too_high', requirement.snippet);
  }
  return pass('experience');
};

const RULES: readonly RuleFn[] = [titleRule, locationRule, financeRule, contractRule, experienceRule];

/**
 * Évalue toutes les règles et renvoie le détail de chacune. Utilisé par le
 * testeur pour montrer ce qui passe et ce qui bloque.
 */
export function evaluateRules(
  offer: FilterableOffer,
  config: FilterConfig = DEFAULT_FILTER_CONFIG,
): RuleOutcome[] {
  return RULES.map((rule) => rule(offer, config));
}

/** Décision : la première règle qui échoue donne le motif. */
export function evaluateOffer(
  offer: FilterableOffer,
  config: FilterConfig = DEFAULT_FILTER_CONFIG,
): FilterDecision {
  for (const outcome of evaluateRules(offer, config)) {
    if (!outcome.passed && outcome.reason) {
      return { accepted: false, reason: outcome.reason, detail: outcome.detail ?? '' };
    }
  }
  return { accepted: true };
}
