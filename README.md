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

**Landing page, calendar, and four rituals: ocean, wind, fire and stone.**
Painted and stylized (Journey, The Witness) rather than photoreal.

- **Landing** (`#/`): 移ろい written top to bottom, with what it means
  (the quiet passing of things) and today's micro-season from the old
  calendar of seventy-two seasons, which changes every five days or so. The
  places sit below on the sand as ink characters (波 風 火 石, and 記 for the
  journal). A quiet "Need to talk to someone?" link is always there.
- **Journal** (`#/journal`): a plain journal for writing you want to keep and
  reread. Saves as you type; entries can be edited and deleted; empty ones
  aren't kept. Stored on the device, encrypted like stones.
- **Your days**: a frosted panel at the left of the landing page (on phones,
  a drawer behind the ☰ beside the name; `#/calendar` opens it), listing every
  month you've written in. A day with anything in it is softly marked; hover
  or tap it to see what happened there. Released rituals store only the date
  and the ritual, no words. Stone and journal days open.
- **Ocean** (`#/ocean`):

- Write anywhere on the sand by hand, with a mouse, trackpad, finger or
  stylus. A driftwood stick follows your hand.
- Drag the sea or sky (or scroll, or use two fingers) to look around: tilt
  up to the horizon, turn left and right.
- The sea never stops. With nothing written, most waves lap at the
  waterline and now and then the swell sends a bigger one. Once you've
  written something and paused, the sea comes for it from the water's side:
  the first wave just touches the nearest writing, and each wave after runs a
  little further, until the last of it is gone. It eases off while you write.
- When the sand is smooth everywhere, the marks are forgotten, quietly.
  That completes the ritual and leaves an ocean mark on today in the calendar.
  Leaving before then leaves no mark.
- **Sound**: each scene plays natural recordings (CC0, from Freesound), steered
  by what happens on screen: a wave washes in with each wave you see, louder
  the further it runs, and sand under the stick while you draw; a summer meadow
  with wind in the trees that rises with the gust; a quiet room while you
  write, the paper catching, and crackling that grows with how much is
  burning. A speaker button in each scene turns sound off and remembers it.
- **Wind** (`#/wind`): a meadow under a tree on a sunny day, sunlight coming
  through the leaves. Type, and your words float in the air in a hand-lettered
  font. They wait until you press **Let the wind take it**; then a gust bends
  the grass and carries them off one by one.
- **Stone** (`#/stone`): a pebble shore in the morning. Type, and each
  character is chiselled into a flat stone in front of you. **Set it on the
  cairn** carries it to the top of a cairn along the shore, where it stays;
  stones can't be removed, and a new cairn starts after eight. The words are
  kept on the device, encrypted (AES-GCM, non-extractable key). Drag (or
  scroll) to look up at the sea and along the shore. Tap a stone on a cairn
  to hold it up to read: the shore blurs behind it and its words show
  beneath; tap anywhere, press Esc or **Put it back** to return it. Stone days
  in the calendar open that day's stones the same way.
- **Fire** (`#/fire`): a dark room, a desk, a candle, and a blank page. Type a
  letter; when it's done, press **Light it**. The candle's flame is carried to
  the corner of the page, which browns, chars, curls and burns away with
  flames, embers and smoke. Then a fresh page.

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
| `/?demo=some%20words` | A robot hand writes the words in cursive (uses the stroke engine below). |
| `/?sea=rough#/ocean` | Big waves most of the time, for watching the sea take the words. |
| `__utsuroi.addMark('2026-10-03', 'fire')` | In the dev console (development builds only): add a calendar mark. |
| `/?tune` | Opens a panel for tuning the groove and the sea. |
| `/tools/glyphs.html` | Glyph sheet: every letter's stroke order and direction, plus a line written by the real writer. |
| `/tools/sound-check.html` | Renders each scene's sound offline over a scripted timeline: loudness, peaks, spectrogram, and buttons to listen. |

## How it works

**Cursive stroke engine** (`src/strokes/`). Not used for input in the app
right now (writing is by hand only), but kept for `?demo`, for the stone
scene, and for writing in someone's own hand later. It turns text into pen
strokes rather than drawing a font:

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
  main.ts              routes between the pages
  pages/               landing page, calendar, journal, icons
  journal/             on-device database: ritual marks, encrypted kept words, month math
  stone/               the stone ritual: pebble shore, carving, cairns, revisiting
  ocean/               the ocean ritual: drawing, looking around, the frame loop
  wind/                the wind ritual: meadow, canopy, words in the air, flight
  fire/                the fire ritual: desk, candle, paper, burn map, flames
  text/, ui/           hand-lettered font, wrapping, typed input, scene shell
  audio/               audio engine; each scene's recordings and how they follow the scene
  strokes/             cursive stroke engine (pure TypeScript, unit tested)
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
- Caveat by The Caveat Project Authors, for typed words in the wind and fire
  scenes. SIL Open Font License 1.1, see `public/fonts/Caveat-OFL.txt`.
- Sounds: CC0 recordings from Freesound by amholma, florianreichelt,
  crashoverride6, DanGasior, teadrinker, brachern, WavJunction.com,
  TicAshfield, craigsmith and alegemaate. See [`public/sounds/CREDITS.md`](public/sounds/CREDITS.md).
