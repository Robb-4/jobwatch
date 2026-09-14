import './style.css';
import { renderCriteria } from './pages/criteria';
import { renderDashboard } from './pages/dashboard';
import { renderLogin } from './pages/login';
import { renderOffers } from './pages/offers';
import { renderRuns } from './pages/runs';
import { renderTester } from './pages/tester';
import { configError, GITHUB_REPO, supabase } from './supabase';
import { errorBox, errorMessage, h, link, replaceChildren } from './ui';

/**
 * Routage par hash (`#/offers?status=new`) : pas de 404 sur GitHub Pages,
 * pas de réécriture serveur. Toute page exige une session ouverte.
 */

type PageRenderer = (root: HTMLElement, params: URLSearchParams) => Promise<void>;

const PAGES: Record<string, { label: string; render: PageRenderer }> = {
  dashboard: { label: 'Tableau de bord', render: renderDashboard },
  offers: { label: 'Offres', render: renderOffers },
  criteria: { label: 'Critères', render: renderCriteria },
  tester: { label: 'Testeur', render: renderTester },
  runs: { label: 'Exécutions', render: renderRuns },
};

const app = document.getElementById('app') as HTMLElement;

function parseHash(): { page: string; params: URLSearchParams } {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path = '', query = ''] = raw.split('?');
  return { page: path || 'dashboard', params: new URLSearchParams(query) };
}

function topbar(active: string, email: string | undefined): HTMLElement {
  const nav = h(
    'nav',
    {},
    ...Object.entries(PAGES).map(([key, page]) => link(key, {}, page.label, { class: key === active ? 'active' : '' })),
  );
  const actions = GITHUB_REPO
    ? h(
        'a',
        { href: `https://github.com/${GITHUB_REPO}/actions`, target: '_blank', rel: 'noopener', class: 'small' },
        'Lancer une récupération (onglet Actions) ↗',
      )
    : null;
  return h(
    'header',
    { class: 'topbar' },
    h('span', { class: 'brand' }, 'JobWatch'),
    nav,
    h('span', { class: 'spacer' }),
    actions,
    h('span', { class: 'user' }, email ?? ''),
    h('button', { onClick: () => void supabase.auth.signOut() }, 'Déconnexion'),
  );
}

let rendering = false;

async function render(): Promise<void> {
  if (rendering) return;
  rendering = true;
  try {
    if (configError) {
      replaceChildren(app, h('main', {}, errorBox(configError)));
      return;
    }
    const { data } = await supabase.auth.getSession();
    const session = data.session;
    if (!session) {
      replaceChildren(app, h('main', {}, renderLogin()));
      return;
    }

    const { page, params } = parseHash();
    const target = PAGES[page] ?? PAGES.dashboard!;
    const main = h('main', {}, h('h1', {}, target.label));
    replaceChildren(app, topbar(PAGES[page] ? page : 'dashboard', session.user.email), main);
    try {
      await target.render(main, params);
    } catch (error) {
      main.append(errorBox(`Erreur : ${errorMessage(error)}`));
    }
  } finally {
    rendering = false;
  }
}

window.addEventListener('hashchange', () => void render());
supabase.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') void render();
});
void render();
