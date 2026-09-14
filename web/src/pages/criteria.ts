import {
  CONFIG_FIELDS,
  DEFAULT_FILTER_CONFIG,
  isDefaultValue,
  resolveFilterConfig,
  SETTING_HELP,
  SETTING_KEYS,
  SETTING_LABELS,
  settingOverrides,
} from '../../../src/core/config';
import type { FilterConfig, SettingRow } from '../../../src/core/types';
import { supabase } from '../supabase';
import { badge, errorMessage, h, loading, replaceChildren } from '../ui';

/**
 * Les critères modifiables. Seuls les écarts par rapport aux valeurs livrées sont
 * enregistrés dans `settings` ; rétablir une valeur d'origine supprime la ligne.
 */

async function loadSettings(): Promise<SettingRow[]> {
  const { data, error } = await supabase.from('settings').select('key,value');
  if (error) throw new Error(error.message);
  return (data ?? []) as SettingRow[];
}

async function saveConfig(config: FilterConfig): Promise<void> {
  const overrides = settingOverrides(config);
  const keep = new Set(overrides.map((o) => o.key));
  const toDelete = Object.values(SETTING_KEYS).filter((key) => !keep.has(key));

  if (overrides.length > 0) {
    const { error } = await supabase.from('settings').upsert(overrides, { onConflict: 'key' });
    if (error) throw new Error(error.message);
  }
  if (toDelete.length > 0) {
    const { error } = await supabase.from('settings').delete().in('key', toDelete);
    if (error) throw new Error(error.message);
  }
}

function linesToList(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

type FieldNode = { input: HTMLTextAreaElement | HTMLInputElement; badge: HTMLElement };

export async function renderCriteria(root: HTMLElement): Promise<void> {
  root.append(loading());
  const config = resolveFilterConfig(await loadSettings());
  const draft: FilterConfig = structuredClone(config);
  const feedback = h('div', {}, '');
  const fieldNodes = new Map<keyof FilterConfig, FieldNode>();

  const refreshBadges = () => {
    for (const field of CONFIG_FIELDS) {
      const node = fieldNodes.get(field);
      if (!node) continue;
      node.badge.replaceChildren(isDefaultValue(field, draft) ? badge('valeur livrée', 'muted') : badge('modifié', 'warn'));
    }
  };

  const readDraft = () => {
    for (const field of CONFIG_FIELDS) {
      const node = fieldNodes.get(field);
      if (!node) continue;
      if (field === 'maxExperienceYears') {
        const n = Number(node.input.value);
        draft.maxExperienceYears = Number.isFinite(n) && n >= 0 ? n : DEFAULT_FILTER_CONFIG.maxExperienceYears;
      } else {
        draft[field] = linesToList(node.input.value);
      }
    }
    refreshBadges();
  };

  const fields = CONFIG_FIELDS.map((field) => {
    let input: HTMLTextAreaElement | HTMLInputElement;
    if (field === 'maxExperienceYears') {
      input = h('input', { type: 'number', min: '0', step: '1', value: String(draft.maxExperienceYears), onInput: readDraft });
    } else {
      const list = draft[field];
      input = h('textarea', { rows: String(Math.min(12, Math.max(3, list.length + 1))), onInput: readDraft }, list.join('\n'));
    }
    const badgeNode = h('span', {});
    fieldNodes.set(field, { input, badge: badgeNode });

    const reset = h(
      'button',
      {
        type: 'button',
        class: 'small',
        onClick: () => {
          const value = DEFAULT_FILTER_CONFIG[field];
          input.value = Array.isArray(value) ? value.join('\n') : String(value);
          readDraft();
        },
      },
      'Valeur livrée',
    );

    return h(
      'div',
      { class: 'field' },
      h('div', { class: 'field-head' }, h('label', {}, SETTING_LABELS[field]), badgeNode, reset),
      h('div', { class: 'help' }, SETTING_HELP[field]),
      input,
    );
  });

  const save = h(
    'button',
    {
      type: 'button',
      class: 'primary',
      onClick: () => {
        readDraft();
        save.disabled = true;
        saveConfig(draft)
          .then(() => {
            feedback.replaceChildren(
              h('div', { class: 'alert alert-ok' }, 'Critères enregistrés. La prochaine récupération les appliquera.'),
            );
          })
          .catch((error) => {
            feedback.replaceChildren(h('div', { class: 'alert alert-error' }, `Enregistrement impossible : ${errorMessage(error)}`));
          })
          .finally(() => {
            save.disabled = false;
          });
      },
    },
    'Enregistrer',
  );

  const resetAll = h(
    'button',
    {
      type: 'button',
      class: 'danger',
      onClick: () => {
        if (!window.confirm('Revenir à la configuration livrée pour tous les critères ?')) return;
        saveConfig(DEFAULT_FILTER_CONFIG)
          .then(() => {
            location.reload();
          })
          .catch((error) => {
            feedback.replaceChildren(h('div', { class: 'alert alert-error' }, `Réinitialisation impossible : ${errorMessage(error)}`));
          });
      },
    },
    'Tout rétablir (configuration livrée)',
  );

  refreshBadges();
  replaceChildren(
    root,
    h('h1', {}, 'Critères'),
    h(
      'p',
      { class: 'muted' },
      'Ces réglages surchargent les valeurs par défaut du code. Ils s’appliquent à la prochaine récupération et au testeur. ',
      'Les mots de contexte, la fenêtre de détection et les alias de contrat restent dans le code (src/core).',
    ),
    feedback,
    h('div', { class: 'card' }, ...fields, h('div', { style: 'display:flex;gap:10px;flex-wrap:wrap' }, save, resetAll)),
  );
}
