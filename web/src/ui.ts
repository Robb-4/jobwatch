/**
 * Petits utilitaires DOM. Tout le contenu est inséré via des nœuds texte :
 * jamais d'innerHTML avec des données d'offres.
 */

type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, string | number | boolean | ((event: Event) => void) | undefined>;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Array<Child | Child[]>
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (typeof value === 'function') {
      node.addEventListener(key.replace(/^on/, '').toLowerCase(), value as EventListener);
    } else if (value === true) {
      node.setAttribute(key, '');
    } else if (key === 'class') {
      node.className = String(value);
    } else {
      node.setAttribute(key, String(value));
    }
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'string' || typeof child === 'number' ? document.createTextNode(String(child)) : child);
  }
  return node;
}

export function replaceChildren(root: HTMLElement, ...children: Array<Node | string>): void {
  root.replaceChildren(...children);
}

const dateTime = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
const dateOnly = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short' });

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : dateTime.format(d);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : dateOnly.format(d);
}

export function badge(text: string, kind: 'ok' | 'warn' | 'error' | 'muted' | 'info' = 'muted'): HTMLElement {
  return h('span', { class: `badge badge-${kind}` }, text);
}

export function errorBox(message: string): HTMLElement {
  return h('div', { class: 'alert alert-error' }, message);
}

export function loading(): HTMLElement {
  return h('p', { class: 'muted' }, 'Chargement…');
}

export function section(title: string, ...children: Array<Node | string>): HTMLElement {
  return h('section', { class: 'card' }, h('h2', {}, title), ...children);
}

export function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) return String((error as { message: unknown }).message);
  return String(error);
}

export const STATUS_LABELS: Record<string, string> = {
  new: 'Retenue, à envoyer',
  reported: 'Envoyée',
  rejected: 'Écartée',
};

export const PERSONAL_STATUS_LABELS: Record<string, string> = {
  to_follow: 'À suivre',
  applied: 'Candidature envoyée',
  discarded: 'Écartée',
};

/** Lien interne (routage par hash). */
export function link(page: string, params: Record<string, string> = {}, text?: string, attrs: Attrs = {}): HTMLAnchorElement {
  const query = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '')).toString();
  return h('a', { href: `#/${page}${query ? `?${query}` : ''}`, ...attrs }, text ?? page);
}
