import { REJECTION_REASON_LABELS, type RejectionReason } from '../../../src/core/types';
import { barChart, columnChart, type ChartPoint } from '../charts';
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

/** Nombre de jours couverts par le graphique d'évolution. */
const HISTORY_DAYS = 30;
/** PostgREST plafonne à 1000 lignes par requête : on pagine. */
const PAGE = 1000;

interface DayRow {
  created_at: string;
  status: string;
}

async function loadRecentOffers(since: Date): Promise<DayRow[]> {
  const rows: DayRow[] = [];
  for (let from = 0; from < PAGE * 20; from += PAGE) {
    const { data, error } = await supabase
      .from('job_offers')
      .select('created_at,status')
      .gte('created_at', since.toISOString())
      .order('created_at', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`historique : ${error.message}`);
    const batch = (data ?? []) as DayRow[];
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }
  return rows;
}

/** Clé « AAAA-MM-JJ » dans le fuseau du navigateur. */
function dayKey(date: Date): string {
  return date.toLocaleDateString('sv-SE');
}

function dailyPoints(rows: readonly DayRow[], since: Date): ChartPoint[] {
  const retained = new Map<string, number>();
  const rejected = new Map<string, number>();
  for (const row of rows) {
    const key = dayKey(new Date(row.created_at));
    const target = row.status === 'rejected' ? rejected : retained;
    target.set(key, (target.get(key) ?? 0) + 1);
  }
  const points: ChartPoint[] = [];
  const shortDate = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit' });
  for (let i = 0; i < HISTORY_DAYS; i += 1) {
    const day = new Date(since);
    day.setDate(since.getDate() + i);
    const key = dayKey(day);
    const kept = retained.get(key) ?? 0;
    const out = rejected.get(key) ?? 0;
    points.push({
      label: shortDate.format(day),
      value: kept,
      tooltip: `${shortDate.format(day)} : ${kept} retenue${kept > 1 ? 's' : ''}, ${out} écartée${out > 1 ? 's' : ''}`,
    });
  }
  return points;
}

export async function renderDashboard(root: HTMLElement): Promise<void> {
  root.append(loading());
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  since.setDate(since.getDate() - (HISTORY_DAYS - 1));

  const countWhere = (context: string, build: (q: ReturnType<typeof supabase.from>) => PromiseLike<{ count: number | null; error: { message: string } | null }>) =>
    build(supabase.from('job_offers')).then((r) => {
      if (r.error) throw new Error(`${context} : ${r.error.message}`);
      return r.count ?? 0;
    });

  const [statuses, reasons, runs, recent, todo, applied, discarded, history] = await Promise.all([
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
    // À traiter : retenue par les filtres, et ni candidature envoyée ni écartée par moi
    countWhere('à traiter', (q) =>
      q
        .select('id', { count: 'exact', head: true })
        .in('status', ['new', 'reported'])
        .or('personal_status.is.null,personal_status.eq.to_follow'),
    ),
    countWhere('candidatures', (q) => q.select('id', { count: 'exact', head: true }).eq('personal_status', 'applied')),
    countWhere('écartées par moi', (q) => q.select('id', { count: 'exact', head: true }).eq('personal_status', 'discarded')),
    loadRecentOffers(since),
  ]).catch((error) => {
    throw new Error(errorMessage(error));
  });

  const countFor = (status: string) => statuses.find((s) => s.status === status)?.count ?? 0;
  const total = statuses.reduce((sum, s) => sum + s.count, 0);

  // Tuiles : le suivi personnel d'abord, la mécanique interne en une ligne discrète.
  const stats = h(
    'div',
    { class: 'stats' },
    stat(todo, 'À traiter', '#/todo', 'todo'),
    stat(applied, 'Candidatures envoyées', '#/offers?personal=applied', 'applied'),
    stat(discarded, 'Écartées par moi', '#/offers?personal=discarded', 'discarded'),
    stat(countFor('rejected'), 'Écartées par les filtres', '#/offers?status=rejected', 'rejected'),
  );
  const technical = h(
    'p',
    { class: 'small muted', style: 'margin:-6px 0 18px' },
    `${countFor('new')} offre${countFor('new') > 1 ? 's' : ''} en attente du prochain mail · `,
    `${countFor('reported')} déjà envoyée${countFor('reported') > 1 ? 's' : ''} par mail · `,
    `${total} en base au total.`,
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
  const reasonsChart =
    reasons.length === 0
      ? h('p', { class: 'muted' }, 'Aucune offre écartée.')
      : barChart(
          reasons.map((r) => ({
            label: REJECTION_REASON_LABELS[r.rejection_reason as RejectionReason] ?? r.rejection_reason ?? 'inconnu',
            value: r.count,
            href: `#/offers?status=rejected&reason=${encodeURIComponent(r.rejection_reason ?? '')}`,
          })),
          { labelHead: 'Motif', valueHead: 'Offres', total: rejectedTotal },
        );

  const history30 = dailyPoints(history, since);
  const retained30 = history30.reduce((s, p) => s + p.value, 0);
  const historyChart = columnChart(history30, { labelHead: 'Jour', valueHead: 'Retenues' });

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
    technical,
    h(
      'div',
      { class: 'grid' },
      section(
        `Offres retenues par jour d’import, ${HISTORY_DAYS} derniers jours`,
        h('p', { class: 'small muted', style: 'margin:-6px 0 10px' }, `${retained30} retenue${retained30 > 1 ? 's' : ''} sur la période ; survoler une colonne pour voir aussi les écartées.`),
        historyChart,
      ),
      section(
        'Répartition des motifs de rejet',
        h('p', { class: 'small muted', style: 'margin:-6px 0 10px' }, `${rejectedTotal} offre${rejectedTotal > 1 ? 's' : ''} écartée${rejectedTotal > 1 ? 's' : ''} au total ; cliquer une barre pour voir les offres.`),
        reasonsChart,
      ),
    ),
    section('Dernière exécution par source', runsTable),
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
