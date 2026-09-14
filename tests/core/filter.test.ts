import { describe, expect, it } from 'vitest';
import { DEFAULT_FILTER_CONFIG } from '../../src/core/config';
import { evaluateOffer, evaluateRules } from '../../src/core/filter';
import type { FilterableOffer } from '../../src/core/types';

const base: FilterableOffer = {
  title: 'Data Analyst H/F',
  company: 'Hôpital Universitaire',
  sector: 'Santé',
  nafCode: '8610Z',
  contractType: 'CDI',
  description: "Vous rejoignez l'équipe data. 2 ans d'expérience souhaités sur SQL et Python.",
};

const withOffer = (patch: Partial<FilterableOffer>) => evaluateOffer({ ...base, ...patch });

describe('règle 1 — intitulé', () => {
  it('accepte un titre data', () => {
    expect(withOffer({})).toEqual({ accepted: true });
  });

  it('« data » ne matche pas « database »', () => {
    const decision = withOffer({ title: 'Database Administrator' });
    expect(decision.accepted).toBe(false);
    if (!decision.accepted) expect(decision.reason).toBe('title_not_matching');
  });

  it('accepte « Analyste de données »', () => {
    expect(withOffer({ title: 'Analyste de données junior' })).toEqual({ accepted: true });
  });
});

describe('règle 2 — secteur finance', () => {
  it('rejette par code NAF 64/65/66', () => {
    expect(withOffer({ nafCode: '6419Z' })).toEqual({ accepted: false, reason: 'finance_naf', detail: 'NAF 6419Z' });
    expect(withOffer({ nafCode: '66' })).toMatchObject({ accepted: false, reason: 'finance_naf' });
  });

  it('rejette par mot-clé dans le nom de l’entreprise', () => {
    expect(withOffer({ company: 'Crédit Agricole Technologies' })).toEqual({
      accepted: false,
      reason: 'finance_keyword',
      detail: 'entreprise: Crédit Agricole',
    });
  });

  it('rejette par mot-clé dans le secteur ou le début de la description', () => {
    expect(withOffer({ sector: 'Assurance' })).toMatchObject({ reason: 'finance_keyword', detail: 'secteur: assurance' });
    expect(withOffer({ description: 'Grande banque française recherche...' })).toMatchObject({
      reason: 'finance_keyword',
      detail: 'description: banque',
    });
  });

  it('ignore un mot-clé finance au-delà des 400 premiers caractères', () => {
    const description = `${'Poste data en santé. '.repeat(25)} Nos clients incluent une banque.`;
    expect(withOffer({ description })).toEqual({ accepted: true });
  });

  it('ne matche pas « bankable » avec « bank »', () => {
    expect(withOffer({ description: 'Un projet bankable pour l’hôpital.' })).toEqual({ accepted: true });
  });
});

describe('règle 3 — type de contrat', () => {
  it('accepte les alias de CDI', () => {
    expect(withOffer({ contractType: 'permanent' })).toEqual({ accepted: true });
    expect(withOffer({ contractType: 'Contrat à durée indéterminée' })).toEqual({ accepted: true });
  });

  it('rejette un CDD et « contract » (Adzuna)', () => {
    expect(withOffer({ contractType: 'CDD' })).toEqual({ accepted: false, reason: 'contract_type', detail: 'contrat: CDD' });
    expect(withOffer({ contractType: 'contract' })).toMatchObject({ reason: 'contract_type' });
  });

  it('ne rejette pas un contrat absent', () => {
    expect(withOffer({ contractType: null })).toEqual({ accepted: true });
  });
});

describe('règle 4 — expérience', () => {
  it('rejette « senior » dans le titre', () => {
    expect(withOffer({ title: 'Senior Data Analyst' })).toEqual({
      accepted: false,
      reason: 'seniority_title',
      detail: 'titre: senior',
    });
    expect(withOffer({ title: 'Lead Data Scientist' })).toMatchObject({ detail: 'titre: lead' });
    expect(withOffer({ title: 'Data Analyst Confirmé' })).toMatchObject({ detail: 'titre: confirmé' });
  });

  it('rejette un mot de séniorité dans la description, listes séparées', () => {
    expect(withOffer({ description: 'Profil senior attendu.' })).toMatchObject({
      reason: 'seniority_description',
      detail: 'description: senior',
    });
    // « principal » ne figure pas dans la liste description : pas de faux positif
    expect(withOffer({ description: 'Vous serez l’interlocuteur principal des métiers.' })).toEqual({ accepted: true });
    expect(withOffer({ title: 'Principal Data Analyst' })).toMatchObject({ reason: 'seniority_title' });
  });

  it('accepte « 3 ans d’expérience », rejette « 5 ans minimum »', () => {
    expect(withOffer({ description: "3 ans d'expérience en analyse de données." })).toEqual({ accepted: true });
    expect(withOffer({ description: '5 ans minimum sur un poste similaire.' })).toEqual({
      accepted: false,
      reason: 'experience_too_high',
      detail: '5 ans',
    });
  });

  it('accepte « une expérience de 3 à 6 ans » (borne basse)', () => {
    expect(withOffer({ description: 'Vous avez une expérience de 3 à 6 ans en data.' })).toEqual({ accepted: true });
  });

  it('accepte « société créée il y a 12 ans » (pas de mot de contexte)', () => {
    expect(withOffer({ description: 'Société créée il y a 12 ans, nous recrutons un analyste.' })).toEqual({
      accepted: true,
    });
  });

  it('retient la plus élevée de plusieurs exigences', () => {
    expect(withOffer({ description: '2 ans d’expérience en SQL, et au moins 4 ans en data.' })).toMatchObject({
      reason: 'experience_too_high',
      detail: '4 ans',
    });
  });
});

describe('ordre des règles et configuration', () => {
  it('la première règle qui échoue donne le motif', () => {
    // Titre hors cible ET banque : c’est le titre qui l’emporte
    expect(withOffer({ title: 'Comptable', company: 'BNP Paribas' })).toMatchObject({ reason: 'title_not_matching' });
  });

  it('evaluateRules détaille les quatre règles', () => {
    const outcomes = evaluateRules({ ...base, title: 'Senior Data Analyst', nafCode: '6419Z' });
    expect(outcomes.map((o) => o.rule)).toEqual(['title', 'finance', 'contract', 'experience']);
    expect(outcomes.map((o) => o.passed)).toEqual([true, false, true, false]);
  });

  it('respecte une configuration surchargée', () => {
    const config = { ...DEFAULT_FILTER_CONFIG, maxExperienceYears: 5, seniorityTitleWords: ['lead'] };
    expect(evaluateOffer({ ...base, title: 'Senior Data Analyst', description: '5 ans minimum requis' }, config)).toEqual({
      accepted: true,
    });
  });
});
