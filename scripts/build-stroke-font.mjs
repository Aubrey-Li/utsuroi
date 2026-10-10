#!/usr/bin/env node
// Converts an SVG single-line ("stroke") font into the compact JSON the
// stroke engine loads at runtime.
//
//   node scripts/build-stroke-font.mjs [input.svg] [output.json]
//
// SVG fonts from the Hershey/EMS family store each glyph as centerline
// polylines (M/L, occasionally C). We keep the raw polylines here; stroke
// direction, ordering and smoothing happen in src/strokes/glyphs.ts so they
// can be unit tested and tuned without regenerating data.
//
// The file is parsed with plain regular expressions instead of an XML parser,
// so no DTDs or external entities are ever processed.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const input = resolve(process.argv[2] ?? 'assets-src/fonts/EMSAllure.svg');
const output = resolve(process.argv[3] ?? 'src/strokes/fonts/ems-allure.json');

const svg = readFileSync(input, 'utf8');

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return NAMED[body.toLowerCase()] ?? match;
  });
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return m ? m[1] : undefined;
}

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// Parses absolute M/L/C path data into polylines. Cubics are flattened.
function parsePath(d) {
  const tokens = d.match(/[MLCmlc]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? [];
  const strokes = [];
  let current = null;
  let cmd = null;
  let i = 0;
  let x = 0;
  let y = 0;
  const next = () => Number(tokens[i++]);
  while (i < tokens.length) {
    const t = tokens[i];
    if (/^[MLC]$/i.test(t)) {
      cmd = t;
      i++;
      continue;
    }
    if (cmd === 'M') {
      x = next();
      y = next();
      current = [x, y];
      strokes.push(current);
      cmd = 'L'; // implicit lineto after the first moveto pair
    } else if (cmd === 'L') {
      x = next();
      y = next();
      current?.push(x, y);
    } else if (cmd === 'C') {
      const [x1, y1, x2, y2, x3, y3] = [next(), next(), next(), next(), next(), next()];
      const steps = 8;
      for (let s = 1; s <= steps; s++) {
        const u = s / steps;
        const a = (1 - u) ** 3;
        const b = 3 * (1 - u) ** 2 * u;
        const c = 3 * (1 - u) * u * u;
        const e = u ** 3;
        current?.push(a * x + b * x1 + c * x2 + e * x3, a * y + b * y1 + c * y2 + e * y3);
      }
      x = x3;
      y = y3;
    } else {
      throw new Error(`Unsupported path command "${cmd}" in ${input}`);
    }
  }
  return strokes
    .filter((s) => s.length >= 4)
    .map((s) => s.map((v) => Math.round(v * 10) / 10));
}

const fontTag = svg.match(/<font\b[^>]*>/)?.[0] ?? '';
const faceTag = svg.match(/<font-face\b[^>]*>/)?.[0] ?? '';
const defaultAdv = num(attr(fontTag, 'horiz-adv-x'), 500);

const glyphs = {};
for (const [tag] of svg.matchAll(/<glyph\b[^>]*>/g)) {
  const unicode = attr(tag, 'unicode');
  if (unicode === undefined) continue;
  const ch = decodeEntities(unicode);
  if ([...ch].length !== 1) continue; // skip ligatures
  const d = attr(tag, 'd');
  glyphs[ch] = {
    a: num(attr(tag, 'horiz-adv-x'), defaultAdv),
    s: d ? parsePath(d) : [],
  };
}

const font = {
  name: attr(faceTag, 'font-family') ?? 'Unknown',
  license: 'SIL Open Font License 1.1 (see assets-src/fonts/README.md)',
  unitsPerEm: num(attr(faceTag, 'units-per-em'), 1000),
  ascent: num(attr(faceTag, 'ascent'), 800),
  descent: num(attr(faceTag, 'descent'), -200),
  capHeight: num(attr(faceTag, 'cap-height'), 500),
  xHeight: num(attr(faceTag, 'x-height'), 300),
  glyphs,
};

writeFileSync(output, JSON.stringify(font) + '\n');
console.log(`Wrote ${Object.keys(glyphs).length} glyphs to ${output}`);
