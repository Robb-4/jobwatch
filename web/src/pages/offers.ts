import { REJECTION_REASON_LABELS, type RejectionReason } from '../../../src/core/types';
import { PAGE_SIZE, supabase } from '../supabase';
import {
  badge,
  errorMessage,
  formatDate,
  h,
  loading,
  PERSONAL_STATUS_LABELS,
  replaceChildren,
  STATUS_LABELS,
} from '../ui';

interface OfferRow {
  id: number;
  source: string;
  title: string;
  company: string | null;
  location: string | null;
  contract_type: string | null;
  salary: string | null;
  url: string;
  published_at: string | null;
  created_at: string;
  status: string;
  rejection_reason: RejectionReason | null;
  rejection_detail: string | null;
  personal_status: string | null;
  note: string | null;
}

interface Filters {
  status: string;
  source: string;
  reason: string;
  personal: string;
  q: string;
  page: number;
}

type SourceInfo = { source: string; label: string };

function readFilters(params: URLSearchParams): Filters {
  return {
    status: params.get('status') ?? '',
    source: params.get('source') ?? '',
    reason: params.get('reason') ?? '',
    personal: params.get('personal') ?? '',
    q: params.get('q') ?? '',
    page: Math.max(1, Number(params.get('page') ?? '1') || 1),
  };
}

function navigate(filters: Filters): void {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== '' && !(key === 'page' && value === 1)) params.set(key, String(value));
  }
  location.hash = `#/offers${params.toString() ? `?${params}` : ''}`;
}

/** PostgREST sépare les conditions de `or()` par des virgules : on retire les caractères de syntaxe. */
function sanitizeSearch(q: string): string {
  return q.replace(/[,()"\\]/g, ' ').trim();
}

async function loadSources(): Promise<SourceInfo[]> {
  const { data } = await supabase.from('latest_source_runs').select('source,label');
  return (data ?? []) as SourceInfo[];
}

async function query(filters: Filters): Promise<{ rows: OfferRow[]; count: number }> {
  let q = supabase.from('job_offers').select('*', { count: 'exact' });
  if (filters.status) q = q.eq('status', filters.status);
  if (filters.source) q = q.eq('source', filters.source);
  if (filters.reason) q = q.eq('rejection_reason', filters.reason);
  if (filters.personal === 'none') q = q.is('personal_status', null);
  else if (filters.personal) q = q.eq('personal_status', filters.personal);
  const search = sanitizeSearch(filters.q);
  if (search) {
    // `ilike` : PostgreSQL rend LIKE sensible à la casse, contrairement à MySQL.
    q = q.or(`title.ilike.%${search}%,company.ilike.%${search}%,location.ilike.%${search}%`);
  }
  const from = (filters.page - 1) * PAGE_SIZE;
  const { data, error, count } = await q
    .order('published_at', { ascending: false, nullsFirst: false })
    .order('id', { ascending: false })
    .range(from, from + PAGE_SIZE - 1);
  if (error) throw new Error(error.message);
  return { rows: (data ?? []) as OfferRow[], count: count ?? 0 };
}

async function updateOffer(id: number, patch: Partial<Pick<OfferRow, 'personal_status' | 'note'>>): Promise<void> {
  const { error } = await supabase.from('job_offers').update(patch).eq('id', id);
  if (error) throw new Error(error.message);
}

function select(
  name: string,
  value: string,
  options: Array<[string, string]>,
  onChange: (v: string) => void,
): HTMLSelectElement {
  return h(
    'select',
    { name, onChange: (e: Event) => onChange((e.target as HTMLSelectElement).value) },
    ...options.map(([v, label]) => h('option', { value: v, selected: v === value }, label)),
  );
}

export async function renderOffers(root: HTMLElement, params: URLSearchParams): Promise<void> {
  const filters = readFilters(params);
  root.append(loading());

  const [sources, result] = await Promise.all([loadSources(), query(filters)]);
  const { rows, count } = result;
  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));

  const searchInput = h('input', { type: 'search', name: 'q', value: filters.q, placeholder: 'Intitulé, entreprise, lieu…' });
  const form = h(
    'form',
    {
      class: 'filters',
      onSubmit: (e: Event) => {
        e.preventDefault();
        navigate({ ...filters, q: searchInput.value, page: 1 });
      },
    },
    h(
      'label',
      {},
      'Statut',
      select('status', filters.status, [['', 'Tous'], ...Object.entries(STATUS_LABELS)], (v) =>
        navigate({ ...filters, status: v, reason: v === 'rejected' ? filters.reason : '', page: 1 }),
      ),
    ),
    h(
      'label',
      {},
      'Source',
      select('source', filters.source, [['', 'Toutes'], ...sources.map((s) => [s.source, s.label] as [string, string])], (v) =>
        navigate({ ...filters, source: v, page: 1 }),
      ),
    ),
    h(
      'label',
      {},
      'Motif de rejet',
      select('reason', filters.reason, [['', 'Tous'], ...Object.entries(REJECTION_REASON_LABELS)], (v) =>
        navigate({ ...filters, reason: v, status: v ? 'rejected' : filters.status, page: 1 }),
      ),
    ),
    h(
      'label',
      {},
      'Suivi personnel',
      select('personal', filters.personal, [['', 'Tous'], ['none', 'Sans suivi'], ...Object.entries(PERSONAL_STATUS_LABELS)], (v) =>
        navigate({ ...filters, personal: v, page: 1 }),
      ),
    ),
    h('label', {}, 'Recherche', searchInput),
    h('button', { type: 'submit' }, 'Filtrer'),
    h(
      'button',
      { type: 'button', onClick: () => navigate({ status: '', source: '', reason: '', personal: '', q: '', page: 1 }) },
      'Réinitialiser',
    ),
  );

  const feedback = h('div', {}, '');

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
          h('th', {}, 'Offre'),
          h('th', {}, 'Contrat / salaire'),
          h('th', {}, 'Source'),
          h('th', {}, 'Publiée'),
          h('th', {}, 'Statut'),
          h('th', {}, 'Suivi'),
        ),
      ),
      h(
        'tbody',
        {},
        ...(rows.length === 0
          ? [h('tr', {}, h('td', { colspan: '6', class: 'muted' }, 'Aucune offre ne correspond à ces filtres.'))]
          : rows.map((offer) => offerRow(offer, sources, feedback))),
      ),
    ),
  );

  const pagination = h(
    'div',
    { class: 'pagination' },
    h(
      'button',
      { type: 'button', disabled: filters.page <= 1, onClick: () => navigate({ ...filters, page: filters.page - 1 }) },
      '← Précédent',
    ),
    h('span', { class: 'muted' }, `Page ${filters.page} / ${pages} · ${count} offre${count > 1 ? 's' : ''}`),
    h(
      'button',
      { type: 'button', disabled: filters.page >= pages, onClick: () => navigate({ ...filters, page: filters.page + 1 }) },
      'Suivant →',
    ),
  );

  replaceChildren(root, h('h1', {}, 'Offres'), h('div', { class: 'card' }, form, feedback, table, pagination));
}

function offerRow(offer: OfferRow, sources: SourceInfo[], feedback: HTMLElement): HTMLElement {
  const sourceLabel = sources.find((s) => s.source === offer.source)?.label ?? offer.source;
  const statusKind = offer.status === 'rejected' ? 'error' : offer.status === 'new' ? 'info' : 'muted';
  const showError = (error: unknown) =>
    feedback.replaceChildren(h('div', { class: 'alert alert-error' }, `Enregistrement impossible : ${errorMessage(error)}`));

  const rejection =
    offer.status === 'rejected'
      ? h(
          'div',
          { class: 'small' },
          h(
            'strong',
            {},
            REJECTION_REASON_LABELS[offer.rejection_reason as RejectionReason] ?? offer.rejection_reason ?? 'motif inconnu',
          ),
          offer.rejection_detail ? h('span', { class: 'muted' }, ` — ${offer.rejection_detail}`) : null,
        )
      : null;

  const noteView = h('div', { class: 'small muted' }, offer.note ?? '');

  const personal = h(
    'select',
    {
      onChange: (e: Event) => {
        const value = (e.target as HTMLSelectElement).value || null;
        updateOffer(offer.id, { personal_status: value }).catch(showError);
      },
    },
    h('option', { value: '', selected: !offer.personal_status }, '—'),
    ...Object.entries(PERSONAL_STATUS_LABELS).map(([v, label]) =>
      h('option', { value: v, selected: offer.personal_status === v }, label),
    ),
  );

  const noteButton = h(
    'button',
    {
      type: 'button',
      class: 'small',
      onClick: () => {
        const next = window.prompt('Note personnelle', offer.note ?? '');
        if (next === null) return;
        const note = next.trim() || null;
        updateOffer(offer.id, { note })
          .then(() => {
            offer.note = note;
            noteView.textContent = note ?? '';
          })
          .catch(showError);
      },
    },
    'Note',
  );

  return h(
    'tr',
    {},
    h(
      'td',
      {},
      h('a', { href: offer.url, target: '_blank', rel: 'noopener', class: 'offer-title' }, offer.title),
      h('div', { class: 'offer-meta' }, [offer.company, offer.location].filter(Boolean).join(' · ')),
      rejection,
      noteView,
    ),
    h('td', {}, offer.contract_type ?? '', offer.salary ? h('div', { class: 'small muted' }, offer.salary) : null),
    h('td', {}, sourceLabel),
    h('td', { class: 'small' }, formatDate(offer.published_at), h('div', { class: 'muted' }, `import. ${formatDate(offer.created_at)}`)),
    h('td', {}, badge(STATUS_LABELS[offer.status] ?? offer.status, statusKind)),
    h('td', {}, personal, ' ', noteButton),
  );
}
