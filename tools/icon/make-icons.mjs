// Builds Utsuroi's icons: 移 in Shippori Mincho ExtraBold (OFL), solid at the
// top and more and more fragmented toward the bottom, cut into vertical strips
// that alternate the glyph with a copy slid sideways.
//
//   npm i opentype.js@1.3.4
//   node make-icons.mjs ShipporiMincho-ExtraBold.ttf out/
//
// Writes favicon.svg (follows the system light/dark theme) and
// icon-light.svg / icon-dark.svg. The PNG sizes in public/ are screenshots of
// icon-light.svg at 180, 192 and 512 px.
import fs from 'node:fs';
import opentype from 'opentype.js';

const [fontPath, outDir] = process.argv.slice(2);
const font = opentype.loadSync(fontPath);

const COLORS = {
  light: { bg: '#f5e6d6', ink: '#3b2733' },
  dark: { bg: '#1e1a22', ink: '#f5e6d6' },
};

// The glyph as a path, about 58% of the tile tall, centered.
const raw = font.getPath('移', 0, 0, 100);
const bb = raw.getBoundingBox();
const scale = 58 / (bb.y2 - bb.y1);
const glyph = font.getPath('移', 0, 0, 100 * scale);
const gb = glyph.getBoundingBox();
const dx = 50 - (gb.x1 + gb.x2) / 2;
const dy = 50 - (gb.y1 + gb.y2) / 2;
const placed = font.getPath('移', dx, dy, 100 * scale);
const d = placed.toPathData(2);
const center = 50;

const gb2 = placed.getBoundingBox();

/** A stable 0..1 value per strip and band, so the same strips are always the broken ones. */
function hash(a, b) {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Solid at the top of the glyph, more and more fragmented toward the bottom:
 * in each horizontal band the strips alternate the glyph with a copy slid
 * sideways, and lower down the gaps widen, the slide grows and strips drop out.
 */
function body({ period, shift, radius, band }, colorAttrs) {
  const { bg, ink } = colorAttrs;
  const clips = [];
  const layers = [];
  const top = gb2.y1;
  const span = gb2.y2 - gb2.y1;
  let solidTo = 0;
  for (let y = 0, b = 0; y < 100; y += band, b++) {
    const t = (y + band / 2 - top) / span;
    const u = Math.min(1, Math.max(0, (t - 0.12) / 0.86));
    const str = 0.95 * u ** 1.5;
    if (str < 0.03) {
      solidTo = y + band;
      continue;
    }
    const fill = period * (1 - (0.06 + 0.4 * str));
    const a = [];
    const c = [];
    for (let x = 0, k = 0; x < 100; x += period, k++) {
      if (hash(k, b) < Math.max(0, str - 0.45) * 0.55) continue;
      (k % 2 ? c : a).push(`<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${fill.toFixed(2)}" height="${(band + 0.35).toFixed(2)}"/>`);
    }
    clips.push(`<clipPath id="a${b}">${a.join('')}</clipPath><clipPath id="b${b}">${c.join('')}</clipPath>`);
    layers.push(`<g clip-path="url(#a${b})"><use href="#g"/></g><g clip-path="url(#b${b})"><use href="#g" transform="translate(${(shift * str).toFixed(2)} 0)"/></g>`);
  }
  return `<defs>
    <path id="g" d="${d}"/>
    <clipPath id="solid"><rect width="100" height="${(solidTo + 0.35).toFixed(2)}"/></clipPath>
    ${clips.join('\n    ')}
  </defs>
  <rect width="100" height="100"${radius ? ` rx="${radius}"` : ''} ${bg}/>
  <g ${ink}>
    <g clip-path="url(#solid)"><use href="#g"/></g>
    ${layers.join('\n    ')}
  </g>`;
}

const svg = (inner, extra = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${extra}${inner}</svg>\n`;

// App icons: fine strips; the system rounds the corners.
const APP = { period: 3.2, shift: 7, radius: 0, band: 2 };
for (const mode of ['light', 'dark']) {
  const c = COLORS[mode];
  fs.writeFileSync(`${outDir}/icon-${mode}.svg`, svg(body(APP, { bg: `fill="${c.bg}"`, ink: `fill="${c.ink}"` })));
}

// The tab icon: fewer, wider strips so they survive at 16 px, and it follows the system theme.
const TAB = { period: 5, shift: 5, radius: 20, band: 4 };
const style = `<style>.bg{fill:${COLORS.light.bg}}.ink{fill:${COLORS.light.ink}}@media (prefers-color-scheme:dark){.bg{fill:${COLORS.dark.bg}}.ink{fill:${COLORS.dark.ink}}}</style>`;
fs.writeFileSync(`${outDir}/favicon.svg`, svg(body(TAB, { bg: 'class="bg"', ink: 'class="ink"' }), style));
console.log('glyph path', d.length, 'chars');
