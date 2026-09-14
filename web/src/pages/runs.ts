import { supabase } from '../supabase';
import { badge, formatDateTime, h, loading, replaceChildren } from '../ui';

interface RunRow {
  id: number;
  source: string;
  label: string;
  succeeded: boolean;
  fetched: number;
  created: number;
  rejected: number;
  duplicates: number;
  error_message: string | null;
  created_at: string;
  reported_at: string | null;
}

const LIMIT = 100;

export async function renderRuns(root: HTMLElement): Promise<void> {
  root.append(loading());
  const { data, error } = await supabase
    .from('source_runs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(LIMIT);
  if (error) throw new Error(error.message);
  const runs = (data ?? []) as RunRow[];

  const table = h(
    'div',
    { class: 'table-wrap' },
    h(
      'table',
      {},
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          h('th', {}, 'Date'),
          h('th', {}, 'Source'),
          h('th', {}, 'État'),
          h('th', { class: 'num' }, 'Récupérées'),
          h('th', { class: 'num' }, 'Retenues'),
          h('th', { class: 'num' }, 'Écartées'),
          h('th', { class: 'num' }, 'Doublons'),
          h('th', {}, 'Rapportée'),
        ),
      ),
      h(
        'tbody',
        {},
        ...(runs.length === 0
          ? [h('tr', {}, h('td', { colspan: '8', class: 'muted' }, 'Aucune exécution enregistrée.'))]
          : runs.map((run) =>
              h(
                'tr',
                {},
                h('td', { class: 'small' }, formatDateTime(run.created_at)),
                h('td', {}, run.label),
                h(
                  'td',
                  {},
                  run.succeeded ? badge('OK', 'ok') : badge('Erreur', 'error'),
                  run.error_message ? h('div', { class: 'small muted' }, run.error_message) : null,
                ),
                h('td', { class: 'num' }, String(run.fetched)),
                h('td', { class: 'num' }, String(run.created)),
                h('td', { class: 'num' }, String(run.rejected)),
                h('td', { class: 'num' }, String(run.duplicates)),
                h('td', { class: 'small muted' }, run.reported_at ? formatDateTime(run.reported_at) : 'en attente'),
              ),
            )),
      ),
    ),
  );

  replaceChildren(
    root,
    h('h1', {}, 'Exécutions'),
    h(
      'p',
      { class: 'muted' },
      `Les ${LIMIT} dernières exécutions, toutes sources confondues. Une ligne par source et par passage du workflow fetch.`,
    ),
    h('div', { class: 'card' }, table),
  );
}
