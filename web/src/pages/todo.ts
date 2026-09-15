import { stripHtml } from '../../../src/core/normalize';
import { supabase } from '../supabase';
import { badge, errorMessage, formatDate, h, loading, PERSONAL_STATUS_LABELS, replaceChildren } from '../ui';

/**
 * Vue « À traiter » : les offres retenues qui ne sont ni « candidature
 * envoyée » ni « écartée par moi » (donc sans suivi, ou « à suivre »), avec un
 * aperçu de l'annonce et des boutons en un clic. C'est l'usage quotidien : on
 * vide la liste, le reste se retrouve dans « Offres » filtré par suivi.
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
  personal_status: string | null;
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
      .select('id,source,title,company,location,contract_type,salary,url,description,published_at,created_at,status,personal_status')
      .in('status', ['new', 'reported'])
      .or('personal_status.is.null,personal_status.eq.to_follow')
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
    const followed = offer.personal_status === 'to_follow';
    // « À suivre » garde l'offre dans la liste, marquée d'une étoile ; les deux autres la retirent.
    const setFollow = async () => {
      const { error: updateError } = await supabase.from('job_offers').update({ personal_status: 'to_follow' }).eq('id', offer.id);
      if (updateError) {
        feedback.replaceChildren(h('div', { class: 'alert alert-error' }, `Enregistrement impossible : ${updateError.message}`));
        return;
      }
      offer.personal_status = 'to_follow';
      card.classList.add('todo-followed');
      followBtn.replaceWith(badge('★ À suivre', 'warn'));
    };
    const followBtn = h('button', { type: 'button', onClick: () => void setFollow() }, `★ ${PERSONAL_STATUS_LABELS.to_follow}`);
    if (followed) card.classList.add('todo-followed');
    buttons.append(
      followed ? badge('★ À suivre', 'warn') : followBtn,
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
      'Toutes les offres retenues qui ne sont ni « candidature envoyée » ni « écartée par moi », les plus récentes en premier. ',
      '« À suivre » la garde ici avec une étoile ; les deux autres boutons la retirent de la liste.',
    ),
    feedback,
    list,
  );
}
