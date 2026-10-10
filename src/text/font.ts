/** The hand-lettered face used for typed words (Caveat, SIL Open Font License). */
export const HAND_FONT = 'Caveat';

/** Fallbacks for scripts Caveat doesn't cover, such as Japanese. */
export const HAND_STACK = `"${HAND_FONT}", "Hiragino Maru Gothic ProN", "Yu Gothic", "Noto Sans JP", sans-serif`;

let loading: Promise<void> | null = null;

/** Loads the font once so canvases can draw with it. Resolves even if loading fails. */
export function loadHandFont(): Promise<void> {
  loading ??= (async () => {
    try {
      const face = new FontFace(HAND_FONT, `url(${import.meta.env.BASE_URL}fonts/Caveat.ttf)`, { weight: '400 700' });
      document.fonts.add(await face.load());
    } catch {
      // Falls back to the next font in the stack.
    }
  })();
  return loading;
}
