import type { Ritual } from '../journal/marks';

const SVG = 'http://www.w3.org/2000/svg';

/** Line drawings for each ritual, on a 24x24 grid. */
const PATHS: Record<Ritual, string[]> = {
  ocean: ['M2 10c2.5 0 2.5-3 5-3s2.5 3 5 3 2.5-3 5-3 2.5 3 5 3', 'M2 16c2.5 0 2.5-3 5-3s2.5 3 5 3 2.5-3 5-3 2.5 3 5 3'],
  wind: ['M3 8h10a3 3 0 1 0-3-3', 'M3 13h15a3 3 0 1 1-3 3', 'M3 18h6'],
  fire: ['M12 3c.6 3 5 5.2 5 10.2A5 5 0 0 1 7 13.5c0-2.4 1.4-3.6 2-5.3 1.3.9 2 2.2 2 3.4 1.2-1.9 1.4-5.2 1-8.6z'],
  stone: ['M4.5 15.5C3.6 11 7 6.5 12.2 6.5c4.9 0 8 3.3 7.2 8-.6 3.4-3.8 4.5-7.4 4.5-3.3 0-6.8-.8-7.5-3.5z', 'M9 12.5h6M10 15h3.5'],
};

export const RITUAL_INFO: Record<Ritual, { name: string; seal: string; line: string; ready: boolean }> = {
  ocean: { name: 'Ocean', seal: '波', line: 'Write in the sand. The tide takes it.', ready: true },
  wind: { name: 'Wind', seal: '風', line: 'Let the wind scatter your words.', ready: false },
  fire: { name: 'Fire', seal: '火', line: 'Write a letter, then burn it.', ready: false },
  stone: { name: 'Stone', seal: '石', line: 'Carve what you want to keep.', ready: false },
};

export function ritualIcon(ritual: Ritual, className = 'icon'): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', `${className} icon-${ritual}`);
  svg.setAttribute('aria-hidden', 'true');
  for (const d of PATHS[ritual]) {
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  return svg;
}

/** Small helper for building elements without innerHTML. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string | null)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) if (c !== null) node.append(c);
  return node;
}
