import { resolveFilterConfig } from '../../../src/core/config';
import { detectExperienceRequirements } from '../../../src/core/experience';
import { evaluateRules } from '../../../src/core/filter';
import { normalizeText } from '../../../src/core/normalize';
import {
  REJECTION_REASON_LABELS,
  type FilterConfig,
  type FilterableOffer,
  type SettingRow,
} from '../../../src/core/types';
import { supabase } from '../supabase';
import { errorMessage, h, loading, replaceChildren } from '../ui';

/**
 * Le testeur tourne entièrement dans le navigateur, en important le même module
 * de filtrage que le script d'ingestion : l'aperçu et la réalité ne peuvent pas
 * diverger. La configuration vient de `settings`, comme pour l'ingestion.
 */

async function loadConfig(): Promise<FilterConfig> {
  const { data, error } = await supabase.from('settings').select('key,value');
  if (error) throw new Error(error.message);
  return resolveFilterConfig((data ?? []) as SettingRow[]);
}

export async function renderTester(root: HTMLElement): Promise<void> {
  root.append(loading());
  let config: FilterConfig;
  try {
    config = await loadConfig();
  } catch (error) {
    throw new Error(`Lecture des critères impossible : ${errorMessage(error)}`);
  }

  const wide = 'width:100%';
  const title = h('input', { type: 'text', placeholder: 'Ex. Data Analyst H/F', style: wide });
  const company = h('input', { type: 'text', placeholder: 'Ex. CHU de Nantes', style: wide });
  const sector = h('input', { type: 'text', placeholder: 'Ex. Activités hospitalières', style: wide });
  const naf = h('input', { type: 'text', placeholder: 'Ex. 8610Z', style: wide });
  const contract = h('input', { type: 'text', placeholder: 'Ex. CDI, permanent…', style: wide });
  const description = h('textarea', { rows: '12', placeholder: 'Coller ici le texte de l’annonce…' });

  const verdict = h('div', { class: 'verdict' }, '');
  const rules = h('ul', { class: 'rules' });
  const extra = h('div', { class: 'small muted' }, '');

  const evaluate = () => {
    const offer: FilterableOffer = {
      title: title.value,
      company: company.value || null,
      sector: sector.value || null,
      nafCode: naf.value || null,
      contractType: contract.value || null,
      description: description.value,
    };
    const outcomes = evaluateRules(offer, config);
    const firstFailure = outcomes.find((o) => !o.passed);

    verdict.className = `verdict ${firstFailure ? 'ko' : 'ok'}`;
    verdict.textContent =
      firstFailure && firstFailure.reason
        ? `Écartée — ${REJECTION_REASON_LABELS[firstFailure.reason]}${firstFailure.detail ? ` (${firstFailure.detail})` : ''}`
        : 'Retenue — toutes les règles passent';

    rules.replaceChildren(
      ...outcomes.map((o) =>
        h(
          'li',
          {},
          h('span', { class: 'icon' }, o.passed ? '✅' : '❌'),
          h(
            'span',
            {},
            h('strong', {}, o.label),
            o.passed || !o.reason
              ? null
              : h('span', { class: 'detail' }, ` — ${REJECTION_REASON_LABELS[o.reason]}${o.detail ? ` : ${o.detail}` : ''}`),
          ),
        ),
      ),
    );

    const requirements = detectExperienceRequirements(normalizeText(`${offer.title} ${offer.description}`));
    extra.textContent =
      requirements.length === 0
        ? 'Aucune exigence d’expérience explicite détectée.'
        : `Exigences d’expérience détectées : ${requirements
            .map((r) => `${r.years} an(s) (« ${r.snippet} »)`)
            .join(', ')} — seuil : ${config.maxExperienceYears} an(s).`;
  };

  for (const input of [title, company, sector, naf, contract, description]) input.addEventListener('input', evaluate);
  evaluate();

  const field = (label: string, input: HTMLElement) =>
    h('div', { class: 'field' }, h('div', { class: 'field-head' }, h('label', {}, label)), input);

  replaceChildren(
    root,
    h('h1', {}, 'Testeur de critères'),
    h(
      'p',
      { class: 'muted' },
      'Collez une annonce : chaque règle est évaluée immédiatement, avec les critères actuellement enregistrés. ',
      'Le moteur est le même que celui de l’ingestion.',
    ),
    h(
      'div',
      { class: 'grid' },
      h(
        'div',
        { class: 'card' },
        field('Intitulé', title),
        field('Entreprise', company),
        field('Secteur déclaré', sector),
        field('Code NAF (France Travail uniquement)', naf),
        field('Type de contrat', contract),
        field('Description', description),
      ),
      h('div', { class: 'card' }, verdict, rules, h('hr'), extra),
    ),
  );
}
