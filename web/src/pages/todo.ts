import { stripHtml } from '../../../src/core/normalize';
import { supabase } from '../supabase';
import { badge, errorMessage, formatDate, h, loading, PERSONAL_STATUS_LABELS, replaceChildren } from '../ui';

/**
 * Vue « À traiter » : les offres retenues qui n'ont pas encore de suivi
 * personnel, avec un aperçu de l'annonce et trois boutons en un clic.
 * C'est l'usage quotidien : on vide la liste, le reste se retrouve dans
 * « Offres » filtré par suivi personnel.
 */

interface TodoOffer {
  id: number;
  source: string;
  title: string;
  company: string | null;
  location: string | null;
  contract_type: string | null;
  salary: string | null;
  url: string;
  description: string | null;
  published_at: string | null;
  created_at: string;
  status: string;
}

const LIMIT = 200;
const PREVIEW_CHARS = 1200;

function preview(description: string | null): string {
  const text = stripHtml(description ?? '').replace(/\s+/g, ' ').trim();
  return text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS)}…` : text;
}

export async function renderTodo(root: HTMLElement): Promise<void> {
  root.append(loading());
  const [{ data: rows, error }, { data: sources }] = await Promise.all([
    supabase
      .from('job_offers')
      .select('id,source,title,company,location,contract_type,salary,url,description,published_at,created_at,status')
      .in('status', ['new', 'reported'])
      .is('personal_status', null)
      .order('published_at', { ascending: false, nullsFirst: false })
      .order('id', { ascending: false })
      .limit(LIMIT),
    supabase.from('latest_source_runs').select('source,label'),
  ]);
  if (error) throw new Error(error.message);
  const offers = (rows ?? []) as TodoOffer[];
  const labels = new Map(((sources ?? []) as Array<{ source: string; label: string }>).map((s) => [s.source, s.label]));

  let remaining = offers.length;
  const counter = h('span', { class: 'badge badge-info' }, '');
  const refreshCounter = () => {
    counter.textContent = remaining === 0 ? 'Tout est traité' : `${remaining} à traiter`;
    counter.className = `badge ${remaining === 0 ? 'badge-ok' : 'badge-info'}`;
  };
  refreshCounter();

  const feedback = h('div', {}, '');
  const list = h('div', { class: 'todo-list' });

  if (offers.length === 0) {
    list.append(h('p', { class: 'muted' }, 'Aucune offre en attente : tout ce qui a été retenu a déjà un suivi.'));
  }

  for (const offer of offers) {
    const card = h('article', { class: 'card todo-card' });
    const meta = [offer.company, offer.location, offer.contract_type, offer.salary, labels.get(offer.source) ?? offer.source]
      .filter((v): v is string => Boolean(v))
      .join(' · ');

    const buttons = h('div', { class: 'todo-actions' });
    const setStatus = async (value: string) => {
      for (const b of buttons.querySelectorAll('button')) b.disabled = true;
      try {
        const { error: updateError } = await supabase.from('job_offers').update({ personal_status: value }).eq('id', offer.id);
        if (updateError) throw new Error(updateError.message);
        card.classList.add('todo-done');
        setTimeout(() => card.remove(), 220);
        remaining -= 1;
        refreshCounter();
        if (remaining === 0) list.append(h('p', { class: 'muted' }, 'Tout est traité. Bravo.'));
      } catch (e) {
        for (const b of buttons.querySelectorAll('button')) b.disabled = false;
        feedback.replaceChildren(h('div', { class: 'alert alert-error' }, `Enregistrement impossible : ${errorMessage(e)}`));
      }
    };
    buttons.append(
      h('button', { type: 'button', class: 'primary', onClick: () => void setStatus('to_follow') }, `★ ${PERSONAL_STATUS_LABELS.to_follow}`),
      h('button', { type: 'button', class: 'success', onClick: () => void setStatus('applied') }, `✓ ${PERSONAL_STATUS_LABELS.applied}`),
      h('button', { type: 'button', class: 'danger', onClick: () => void setStatus('discarded') }, `✕ ${PERSONAL_STATUS_LABELS.discarded}`),
    );

    card.append(
      h(
        'div',
        { class: 'todo-head' },
        h(
          'div',
          {},
          h('a', { href: offer.url, target: '_blank', rel: 'noopener', class: 'todo-title' }, offer.title),
          h('div', { class: 'offer-meta' }, meta),
        ),
        h(
          'div',
          { class: 'todo-date' },
          badge(offer.status === 'new' ? 'nouvelle' : 'envoyée', offer.status === 'new' ? 'info' : 'muted'),
          h('div', { class: 'small muted' }, `publiée le ${formatDate(offer.published_at ?? offer.created_at)}`),
        ),
      ),
      h('details', {}, h('summary', {}, 'Aperçu de l’annonce'), h('div', { class: 'todo-desc' }, preview(offer.description) || 'Pas de description.')),
      buttons,
    );
    list.append(card);
  }

  replaceChildren(
    root,
    h('div', { class: 'todo-header' }, h('h1', {}, 'À traiter'), counter),
    h(
      'p',
      { class: 'muted' },
      'Les offres retenues sans suivi personnel, les plus récentes en premier. Un clic classe l’offre et la retire de la liste ; ',
      'on la retrouve ensuite dans « Offres » via le filtre Suivi personnel.',
    ),
    feedback,
    list,
  );
}
