import { optionalEnv, requireEnv } from './env';
import { isMain } from './is-main';
import { createSmtpMailer, type Mailer } from './mailer';
import type { JobOfferRow, ReportRepository, SourceRunRow } from './repository';
import { createServiceClient, SupabaseRepository } from './supabase';

/**
 * Tâche `report` : envoie par mail les offres en `new`, puis les passe en
 * `reported` — seulement après un envoi réussi. Envoie même sans offre :
 * c'est la preuve de vie.
 */

export type ReportPeriod = 'matin' | 'soir';

export interface ReportContent {
  subject: string;
  text: string;
  html: string;
}

export interface ReportDeps {
  repo: ReportRepository;
  mailer: Mailer;
  from: string;
  to: string;
  now?: Date;
  period?: ReportPeriod;
  timeZone?: string;
  log?: (message: string) => void;
}

/** « matin » avant midi (heure de Paris), « soir » ensuite. */
export function periodFor(date: Date, timeZone = 'Europe/Paris'): ReportPeriod {
  const parts = new Intl.DateTimeFormat('fr-FR', { hour: 'numeric', hour12: false, timeZone }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  return hour < 12 ? 'matin' : 'soir';
}

export function subjectFor(count: number, period: ReportPeriod): string {
  if (count === 0) return `JobWatch — aucune nouvelle offre (${period})`;
  return `JobWatch — ${count} ${count === 1 ? 'nouvelle offre' : 'nouvelles offres'} (${period})`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const dateFormat = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeZone: 'Europe/Paris' });

function formatDate(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : dateFormat.format(date);
}

/**
 * Sources encore en panne : pour chaque source, seule la dernière exécution
 * non rapportée compte. Une source rétablie entre-temps n'est pas signalée.
 */
export function failingSources(runs: readonly SourceRunRow[]): SourceRunRow[] {
  const latest = new Map<string, SourceRunRow>();
  for (const run of runs) {
    const current = latest.get(run.source);
    if (!current || run.created_at > current.created_at) latest.set(run.source, run);
  }
  return [...latest.values()].filter((run) => !run.succeeded);
}

export function aggregateRuns(runs: readonly SourceRunRow[]) {
  return runs.reduce(
    (acc, run) => ({
      fetched: acc.fetched + run.fetched,
      rejected: acc.rejected + run.rejected,
      duplicates: acc.duplicates + run.duplicates,
      executions: acc.executions + 1,
    }),
    { fetched: 0, rejected: 0, duplicates: 0, executions: 0 },
  );
}

export function buildReport(
  offers: readonly JobOfferRow[],
  runs: readonly SourceRunRow[],
  period: ReportPeriod,
  labels: Record<string, string> = {},
): ReportContent {
  const subject = subjectFor(offers.length, period);
  const failing = failingSources(runs);
  const totals = aggregateRuns(runs);
  const sourceLabel = (source: string) => labels[source] ?? runs.find((r) => r.source === source)?.label ?? source;

  // --- Texte brut ---
  const textLines: string[] = [subject, ''];
  if (failing.length > 0) {
    textLines.push('⚠ Sources en erreur au dernier essai :');
    for (const run of failing) textLines.push(`  - ${run.label} : ${run.error_message ?? 'erreur inconnue'}`);
    textLines.push('');
  }
  if (offers.length === 0) {
    textLines.push('Aucune nouvelle offre depuis le dernier rapport.');
  } else {
    for (const offer of offers) {
      const parts = [offer.company, offer.location, offer.salary, sourceLabel(offer.source), formatDate(offer.published_at)]
        .filter((p): p is string => Boolean(p));
      textLines.push(`- ${offer.title}`, `  ${parts.join(' · ')}`, `  ${offer.url}`);
    }
  }
  textLines.push(
    '',
    `Depuis le dernier rapport (${totals.executions} exécution(s)) : ${totals.fetched} récupérée(s), ${totals.rejected} écartée(s) par les filtres, ${totals.duplicates} doublon(s) ignoré(s).`,
  );

  // --- HTML ---
  const rows = offers
    .map(
      (offer) => `<tr>
  <td><a href="${escapeHtml(offer.url)}">${escapeHtml(offer.title)}</a></td>
  <td>${escapeHtml(offer.company ?? '')}</td>
  <td>${escapeHtml(offer.location ?? '')}</td>
  <td>${escapeHtml(offer.salary ?? '')}</td>
  <td>${escapeHtml(sourceLabel(offer.source))}</td>
  <td>${formatDate(offer.published_at)}</td>
</tr>`,
    )
    .join('\n');

  const alert =
    failing.length === 0
      ? ''
      : `<div style="border:1px solid #c0392b;background:#fdecea;padding:12px;margin-bottom:16px;border-radius:6px">
  <strong>⚠ Sources en erreur au dernier essai</strong>
  <ul style="margin:8px 0 0">${failing
    .map((run) => `<li><strong>${escapeHtml(run.label)}</strong> : ${escapeHtml(run.error_message ?? 'erreur inconnue')}</li>`)
    .join('')}</ul>
</div>`;

  const table =
    offers.length === 0
      ? '<p>Aucune nouvelle offre depuis le dernier rapport.</p>'
      : `<table cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;font-size:14px">
  <thead><tr style="background:#f2f2f2;text-align:left">
    <th>Intitulé</th><th>Entreprise</th><th>Lieu</th><th>Salaire</th><th>Source</th><th>Publiée</th>
  </tr></thead>
  <tbody>${rows}</tbody>
</table>`;

  const html = `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:900px;margin:auto;color:#222">
  <h2 style="margin-top:0">${escapeHtml(subject)}</h2>
  ${alert}
  ${table}
  <p style="margin-top:24px;color:#666;font-size:13px">
    Depuis le dernier rapport (${totals.executions} exécution(s)) :
    <strong>${totals.fetched}</strong> récupérée(s) ·
    <strong>${totals.rejected}</strong> écartée(s) par les filtres ·
    <strong>${totals.duplicates}</strong> doublon(s) ignoré(s).
  </p>
</div>`;

  return { subject, text: textLines.join('\n'), html };
}

export async function runReport(deps: ReportDeps): Promise<ReportContent> {
  const log = deps.log ?? (() => {});
  const now = deps.now ?? new Date();
  const period = deps.period ?? periodFor(now, deps.timeZone);

  const [offers, runs] = await Promise.all([deps.repo.loadNewOffers(), deps.repo.loadUnreportedRuns()]);
  const content = buildReport(offers, runs, period);
  log(`${offers.length} offre(s) à rapporter, ${runs.length} exécution(s) à comptabiliser`);

  // L'envoi d'abord : en cas d'échec SMTP, rien n'est marqué et tout repart au rapport suivant.
  await deps.mailer.send({ from: deps.from, to: deps.to, ...content });
  log(`Mail envoyé : ${content.subject}`);

  const reportedAt = now.toISOString();
  if (offers.length > 0) await deps.repo.markOffersReported(offers.map((o) => o.id), reportedAt);
  if (runs.length > 0) await deps.repo.markRunsReported(runs.map((r) => r.id), reportedAt);
  return content;
}

async function main(): Promise<void> {
  const repo = new SupabaseRepository(createServiceClient());
  const forced = optionalEnv('REPORT_PERIOD', '');
  await runReport({
    repo,
    mailer: createSmtpMailer(),
    from: requireEnv('MAIL_FROM'),
    to: requireEnv('MAIL_TO'),
    ...(forced === 'matin' || forced === 'soir' ? { period: forced } : {}),
    log: (message) => console.log(message),
  });
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
