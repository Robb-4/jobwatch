import { REJECTION_REASON_LABELS, type RejectionReason } from '../../../src/core/types';
import { supabase } from '../supabase';
import { badge, errorMessage, formatDateTime, h, link, loading, replaceChildren, section, STATUS_LABELS } from '../ui';

interface StatusCount {
  status: string;
  count: number;
}
interface ReasonCount {
  rejection_reason: string | null;
  count: number;
}
interface LatestRun {
  source: string;
  label: string;
  succeeded: boolean;
  fetched: number;
  created: number;
  rejected: number;
  duplicates: number;
  error_message: string | null;
  created_at: string;
}
interface RecentOffer {
  id: number;
  title: string;
  company: string | null;
  location: string | null;
  url: string;
  source: string;
  status: string;
  published_at: string | null;
  created_at: string;
}

function unwrap<T>(result: { data: T | null; error: { message: string } | null }, context: string): T {
  if (result.error) throw new Error(`${context} : ${result.error.message}`);
  return (result.data ?? []) as T;
}

export async function renderDashboard(root: HTMLElement): Promise<void> {
  root.append(loading());
  const [statuses, reasons, runs, recent, todo] = await Promise.all([
    supabase.from('job_offer_status_counts').select('*').then((r) => unwrap<StatusCount[]>(r, 'compteurs')),
    supabase.from('rejection_reason_counts').select('*').then((r) => unwrap<ReasonCount[]>(r, 'motifs')),
    supabase.from('latest_source_runs').select('*').then((r) => unwrap<LatestRun[]>(r, 'exécutions')),
    supabase
      .from('job_offers')
      .select('id,title,company,location,url,source,status,published_at,created_at')
      .in('status', ['new', 'reported'])
      .order('created_at', { ascending: false })
      .limit(10)
      .then((r) => unwrap<RecentOffer[]>(r, 'dernières offres')),
    supabase
      .from('job_offers')
      .select('id', { count: 'exact', head: true })
      .in('status', ['new', 'reported'])
      .is('personal_status', null)
      .then((r) => {
        if (r.error) throw new Error(`à traiter : ${r.error.message}`);
        return r.count ?? 0;
      }),
  ]).catch((error) => {
    throw new Error(errorMessage(error));
  });

  const countFor = (status: string) => statuses.find((s) => s.status === status)?.count ?? 0;
  const total = statuses.reduce((sum, s) => sum + s.count, 0);

  const stats = h(
    'div',
    { class: 'stats' },
    stat(todo, 'À traiter (sans suivi)', '#/todo', 'todo'),
    stat(countFor('new'), STATUS_LABELS.new!, '#/offers?status=new', 'new'),
    stat(countFor('reported'), STATUS_LABELS.reported!, '#/offers?status=reported', 'reported'),
    stat(countFor('rejected'), STATUS_LABELS.rejected!, '#/offers?status=rejected', 'rejected'),
    stat(total, 'Total en base', null, 'total'),
  );

  const runsTable =
    runs.length === 0
      ? h('p', { class: 'muted' }, 'Aucune exécution enregistrée pour l’instant.')
      : h(
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
                h('th', {}, 'Source'),
                h('th', {}, 'Dernière exécution'),
                h('th', {}, 'État'),
                h('th', { class: 'num' }, 'Récupérées'),
                h('th', { class: 'num' }, 'Retenues'),
                h('th', { class: 'num' }, 'Écartées'),
                h('th', { class: 'num' }, 'Doublons'),
              ),
            ),
            h(
              'tbody',
              {},
              ...runs.map((run) =>
                h(
                  'tr',
                  {},
                  h('td', {}, run.label),
                  h('td', {}, formatDateTime(run.created_at)),
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
                ),
              ),
            ),
          ),
        );

  const rejectedTotal = reasons.reduce((sum, r) => sum + r.count, 0);
  const reasonsList =
    reasons.length === 0
      ? h('p', { class: 'muted' }, 'Aucune offre écartée.')
      : h(
          'table',
          {},
          h(
            'tbody',
            {},
            ...[...reasons]
              .sort((a, b) => b.count - a.count)
              .map((r) =>
                h(
                  'tr',
                  {},
                  h(
                    'td',
                    {},
                    link(
                      'offers',
                      { status: 'rejected', reason: r.rejection_reason ?? '' },
                      REJECTION_REASON_LABELS[r.rejection_reason as RejectionReason] ?? r.rejection_reason ?? 'inconnu',
                    ),
                  ),
                  h('td', { class: 'num' }, String(r.count)),
                  h('td', { class: 'num muted' }, `${Math.round((r.count / rejectedTotal) * 100)} %`),
                ),
              ),
          ),
        );

  const recentList =
    recent.length === 0
      ? h('p', { class: 'muted' }, 'Aucune offre retenue pour l’instant.')
      : h(
          'table',
          {},
          h(
            'tbody',
            {},
            ...recent.map((o) =>
              h(
                'tr',
                {},
                h(
                  'td',
                  {},
                  h('a', { href: o.url, target: '_blank', rel: 'noopener', class: 'offer-title' }, o.title),
                  h('div', { class: 'offer-meta' }, [o.company, o.location].filter(Boolean).join(' · ')),
                ),
                h('td', {}, badge(STATUS_LABELS[o.status] ?? o.status, o.status === 'new' ? 'info' : 'muted')),
                h('td', { class: 'muted small' }, formatDateTime(o.published_at ?? o.created_at)),
              ),
            ),
          ),
        );

  replaceChildren(
    root,
    h('h1', {}, 'Tableau de bord'),
    stats,
    h(
      'div',
      { class: 'grid' },
      section('Dernière exécution par source', runsTable),
      section('Répartition des motifs de rejet', reasonsList),
    ),
    section(
      'Dernières offres retenues',
      recentList,
      h('p', {}, link('offers', { status: 'new' }, 'Voir toutes les offres retenues →')),
    ),
  );
}

function stat(value: number, label: string, href: string | null, kind: string): HTMLElement {
  const content = [h('div', { class: 'value' }, String(value)), h('div', { class: 'label' }, label)];
  const cls = `stat stat-${kind}`;
  return href ? h('a', { class: cls, href, style: 'color:inherit' }, ...content) : h('div', { class: cls }, ...content);
}
