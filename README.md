# Utsuroi 移ろい

A journal for the words you don't need to keep.

Most journaling is about keeping things. Utsuroi is for the other kind of
writing: anger, regret, the things you never said to someone. You choose a
place, write, and the place takes the words. Write in the sand and let the
tide wash it away, scatter it on the wind, burn a letter. Or carve it into
stone if you want to keep it.

*Utsuroi* (移ろい) means shifting, fading, passing, like the seasons
changing or the color going out of a flower.

## Status

**M0: sand-writing prototype.** One scene, the ocean at dusk, in a
painted, stylized look (Journey, The Witness) rather than photoreal:

- Type, and a driftwood stick writes your words into the sand in cursive,
  stroke by stroke, a few letters behind you. Backspace and the stick
  smooths the letter away.
- Or switch to **Draw** and write with your finger or mouse.
- The sea never stops. Most waves lap at the waterline; now and then the
  swell builds and a bigger wave runs up and takes some of the writing,
  nearest the water first. The sea eases off a little while you're writing.
  Once a line is smooth again you can write on it.
- When the sand is smooth everywhere, the words are forgotten: "The sea has it."

Nothing you write is stored, sent anywhere, or logged. The words exist only
as marks in the sand; once the sea takes them, the text is gone from memory
too.

The full product design (four rituals, the calendar, stones, privacy model,
milestones) is in [`docs/design.html`](docs/design.html).

## Running it

Requires Node 22.12+ (the repo pins 24 in `.nvmrc`).

```sh
nvm use
npm install
npm run dev        # http://localhost:5199
npm test           # unit tests (stroke engine, sand, tide)
npm run build      # typecheck + production build into dist/
```

Renders with three.js `WebGPURenderer`, which falls back to WebGL2 where
WebGPU isn't available.

### Development helpers

| URL | What it does |
| --- | --- |
| `/?demo=some%20words` | Types the text automatically. |
| `/?sea=rough` | Big waves most of the time, for watching the sea take the words. |
| `/?tune` | Opens a panel for tuning the handwriting, the groove and the sea. |
| `/tools/glyphs.html` | Glyph sheet: every letter's stroke order and direction, plus a line written by the real writer. |

## How the handwriting works

Typed text is turned into pen strokes, not drawn as a font:

1. **Single-line font.** EMS Allure stores each letter as centerline
   strokes. `npm run fonts` converts the SVG font to JSON.
2. **Pen order.** Traced fonts often run backwards. `src/strokes/glyphs.ts`
   uses the font's join points to fix stroke direction, and defers i dots,
   t crossbars and x crosses until the word is finished.
3. **Variation.** Each letter gets a slightly different size, slant and
   rotation, plus a wandering baseline and a little tremor.
4. **Timing.** Speed follows the two-thirds power law from motor-control
   research: the hand slows in tight curves and speeds up on straight runs
   (`src/strokes/timing.ts`). Pressure is firmer where the stick lands and in
   sharp turns, and trails off at the end of a stroke.
5. **Playback.** `SandWriter` queues typed letters and plays them back in
   real time, catching up when you type faster. It joins letters without
   lifting where the cursive connects.
6. **Sand.** Each step of the stick stamps a groove with low ridges into a
   height grid (`src/sand/field.ts`). Waves relax and blur it. The sand
   shader (`src/scene/sand-material.ts`, TSL) shades it in a few designed
   color bands (light, mid, shadow, inked groove), with wet sand, crisp foam,
   sparkle, and the stick's shadow drawn analytically.
7. **Sea.** `src/sand/tide.ts` runs waves with varied gaps and reach. A slow
   swell makes big waves come in sets.

## Layout

```
src/
  main.ts              app wiring: input, phases of the ritual, frame loop
  strokes/             handwriting engine (pure TypeScript, unit tested)
  sand/                sand height grid, water state, tide
  scene/               three.js world and the sand shader
  style.css            interface
tools/glyphs.html      glyph sheet for tuning the cursive
assets-src/fonts/      source font and its license
docs/design.html       product design doc
```

## Credits

- [three.js](https://threejs.org) (MIT).
- EMS Allure single-line font, derived from Allura by Rob Leuschke (TypeSETit).
  SIL Open Font License 1.1. See [`assets-src/fonts`](assets-src/fonts).
