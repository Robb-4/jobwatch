import { h } from './ui';

/**
 * Graphiques SVG sans dépendance : une colonne par jour, ou une barre par
 * catégorie. Une seule série par graphique (couleur --chart-series), marques
 * fines, grille hairline, info-bulle au survol et au clavier, et un tableau
 * jumeau dépliable pour que chaque valeur reste lisible sans la couleur.
 */

export interface ChartPoint {
  /** Libellé court (axe, tableau). */
  label: string;
  value: number;
  /** Texte de l'info-bulle ; défaut : « label : value ». */
  tooltip?: string;
  /** Lien optionnel (barres cliquables). */
  href?: string;
}

const NS = 'http://www.w3.org/2000/svg';

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
  ...children: Array<Node | string>
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  for (const c of children) node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return node;
}

/** Pas d'axe « propre » (1, 2, 5 × 10^k) pour 3 à 5 graduations. */
function niceTicks(max: number): number[] {
  if (max <= 0) return [0, 1];
  const rough = max / 4;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((m) => m * power).find((s) => max / s <= 5) ?? power * 10;
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return ticks;
}

/** Colonne à sommet arrondi (4px), base carrée. */
function columnPath(x: number, y: number, w: number, hgt: number, r = 4): string {
  const rr = Math.min(r, w / 2, hgt);
  const bottom = y + hgt;
  return [
    `M${x},${bottom}`,
    `V${y + rr}`,
    `Q${x},${y} ${x + rr},${y}`,
    `H${x + w - rr}`,
    `Q${x + w},${y} ${x + w},${y + rr}`,
    `V${bottom}`,
    'Z',
  ].join(' ');
}

/** Barre horizontale à bout droit arrondi (4px), base carrée à gauche. */
function barPath(x: number, y: number, w: number, hgt: number, r = 4): string {
  const rr = Math.min(r, hgt / 2, w);
  return [
    `M${x},${y}`,
    `H${x + w - rr}`,
    `Q${x + w},${y} ${x + w},${y + rr}`,
    `V${y + hgt - rr}`,
    `Q${x + w},${y + hgt} ${x + w - rr},${y + hgt}`,
    `H${x}`,
    'Z',
  ].join(' ');
}

function tooltipLayer(container: HTMLElement) {
  const tip = h('div', { class: 'chart-tip', hidden: true });
  container.append(tip);
  return {
    show(text: string, xPct: number, yPct: number) {
      tip.textContent = text;
      tip.hidden = false;
      tip.style.left = `${xPct}%`;
      tip.style.top = `${yPct}%`;
    },
    hide() {
      tip.hidden = true;
    },
  };
}

function dataTable(points: readonly ChartPoint[], labelHead: string, valueHead: string): HTMLElement {
  return h(
    'details',
    { class: 'chart-table' },
    h('summary', {}, 'Voir les données'),
    h(
      'table',
      {},
      h('thead', {}, h('tr', {}, h('th', {}, labelHead), h('th', { class: 'num' }, valueHead))),
      h('tbody', {}, ...points.map((p) => h('tr', {}, h('td', {}, p.label), h('td', { class: 'num' }, String(p.value))))),
    ),
  );
}

export interface ColumnChartOptions {
  /** Intitulé de la colonne « valeur » du tableau jumeau. */
  valueHead: string;
  labelHead: string;
  /** Un libellé d'axe toutes les N colonnes (défaut : calculé pour ~6 libellés). */
  labelEvery?: number;
  height?: number;
}

/** Colonnes (une par point), ex. offres retenues par jour. */
export function columnChart(points: readonly ChartPoint[], opts: ColumnChartOptions): HTMLElement {
  const width = 640;
  const height = opts.height ?? 200;
  const margin = { top: 18, right: 8, bottom: 26, left: 34 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const max = Math.max(0, ...points.map((p) => p.value));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1] ?? 1;
  const yFor = (v: number) => margin.top + plotH - (v / top) * plotH;

  const root = svg('svg', { viewBox: `0 0 ${width} ${height}`, class: 'chart', role: 'img' });

  // Grille hairline + graduations
  for (const t of ticks) {
    const y = yFor(t);
    root.append(
      svg('line', { x1: margin.left, x2: width - margin.right, y1: y, y2: y, class: t === 0 ? 'chart-axis' : 'chart-grid' }),
    );
    root.append(svg('text', { x: margin.left - 6, y: y + 3.5, class: 'chart-tick', 'text-anchor': 'end' }, String(t)));
  }

  const n = Math.max(1, points.length);
  const band = plotW / n;
  const barW = Math.max(2, Math.min(24, band - 2)); // 2px de surface entre colonnes voisines
  const every = opts.labelEvery ?? Math.max(1, Math.ceil(n / 6));
  const maxIndex = points.findIndex((p) => p.value === max);

  const container = h('div', { class: 'chart-wrap' });
  const tip = tooltipLayer(container);

  points.forEach((p, i) => {
    const x = margin.left + i * band + (band - barW) / 2;
    const y = yFor(p.value);
    const hgt = margin.top + plotH - y;
    if (p.value > 0) root.append(svg('path', { d: columnPath(x, y, barW, hgt), class: 'chart-mark' }));

    if (i % every === 0 || i === n - 1) {
      root.append(svg('text', { x: x + barW / 2, y: height - 8, class: 'chart-tick', 'text-anchor': 'middle' }, p.label));
    }
    // Un seul libellé direct : le maximum
    if (i === maxIndex && max > 0) {
      root.append(svg('text', { x: x + barW / 2, y: y - 5, class: 'chart-label', 'text-anchor': 'middle' }, String(p.value)));
    }

    // Zone de survol : toute la bande, pleine hauteur
    const hit = svg('rect', {
      x: margin.left + i * band,
      y: margin.top,
      width: band,
      height: plotH,
      class: 'chart-hit',
      tabindex: 0,
    });
    const text = p.tooltip ?? `${p.label} : ${p.value}`;
    const show = () => tip.show(text, ((margin.left + i * band + band / 2) / width) * 100, (Math.max(0, y - 30) / height) * 100);
    hit.addEventListener('mouseenter', show);
    hit.addEventListener('focus', show);
    hit.addEventListener('mouseleave', () => tip.hide());
    hit.addEventListener('blur', () => tip.hide());
    root.append(hit);
  });

  container.append(root);
  return h('div', {}, container, dataTable(points, opts.labelHead, opts.valueHead));
}

export interface BarChartOptions {
  valueHead: string;
  labelHead: string;
  /** Total pour le pourcentage dans l'info-bulle (défaut : somme). */
  total?: number;
}

/** Barres horizontales triées, ex. motifs de rejet. Valeur au bout de chaque barre. */
export function barChart(points: readonly ChartPoint[], opts: BarChartOptions): HTMLElement {
  const sorted = [...points].sort((a, b) => b.value - a.value);
  const width = 640;
  const rowH = 30;
  const barH = 14;
  const labelW = 210;
  const margin = { top: 6, right: 48, left: labelW + 8 };
  const height = margin.top + sorted.length * rowH + 6;
  const plotW = width - margin.left - margin.right;
  const max = Math.max(1, ...sorted.map((p) => p.value));
  const total = opts.total ?? sorted.reduce((s, p) => s + p.value, 0);

  const container = h('div', { class: 'chart-wrap' });
  const tip = tooltipLayer(container);
  const root = svg('svg', { viewBox: `0 0 ${width} ${height}`, class: 'chart', role: 'img' });
  root.append(svg('line', { x1: margin.left, x2: margin.left, y1: margin.top, y2: height - 6, class: 'chart-axis' }));

  sorted.forEach((p, i) => {
    const y = margin.top + i * rowH + (rowH - barH) / 2;
    const w = (p.value / max) * plotW;
    const label = p.label.length > 34 ? `${p.label.slice(0, 33)}…` : p.label;
    root.append(svg('text', { x: labelW, y: y + barH - 3, class: 'chart-tick', 'text-anchor': 'end' }, label));
    if (w > 0) root.append(svg('path', { d: barPath(margin.left, y, w, barH), class: 'chart-mark' }));
    root.append(svg('text', { x: margin.left + w + 6, y: y + barH - 3, class: 'chart-label' }, String(p.value)));

    const hit = svg('rect', { x: 0, y: margin.top + i * rowH, width, height: rowH, class: 'chart-hit', tabindex: 0 });
    const pct = total > 0 ? Math.round((p.value / total) * 100) : 0;
    const text = p.tooltip ?? `${p.label} : ${p.value} (${pct} %)`;
    const show = () => tip.show(text, ((margin.left + w / 2) / width) * 100, ((margin.top + i * rowH - 4) / height) * 100);
    hit.addEventListener('mouseenter', show);
    hit.addEventListener('focus', show);
    hit.addEventListener('mouseleave', () => tip.hide());
    hit.addEventListener('blur', () => tip.hide());
    if (p.href) {
      hit.style.cursor = 'pointer';
      const href = p.href;
      hit.addEventListener('click', () => {
        location.hash = href;
      });
    }
    root.append(hit);
  });

  container.append(root);
  return h('div', {}, container, dataTable(sorted, opts.labelHead, opts.valueHead));
}
