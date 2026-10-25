/**
 * Shape-label wrapping without a DOM. Widths are estimated from an average glyph width, which
 * is close enough for the sans-serif UI fonts to keep labels inside their shape everywhere a
 * diagram is drawn (canvas, viewer, present mode, SVG/PNG/PDF export).
 */

export interface WrappedLabel {
  lines: string[];
  fontSize: number;
  lineHeight: number;
}

const CHAR_W = 0.56; // average advance per em
const LINE_H = 1.25;
const MAX_FONT = 13;
const MIN_FONT = 9;

/** Usable text area of a shape: padded rectangle, or the box inscribed in an ellipse. */
function innerBox(width: number, height: number, ellipse: boolean) {
  return ellipse ? { w: width * 0.7 - 8, h: height * 0.7 - 4 } : { w: width - 16, h: height - 10 };
}

function wrapAt(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (let word of paragraph.split(/\s+/).filter(Boolean)) {
      // A single word wider than the box is hard-broken.
      while (word.length > maxChars) {
        if (line) {
          lines.push(line);
          line = '';
        }
        lines.push(word.slice(0, maxChars));
        word = word.slice(maxChars);
      }
      if (!line) line = word;
      else if (line.length + 1 + word.length <= maxChars) line += ` ${word}`;
      else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

/**
 * Wraps `text` to fit a `width`×`height` shape, stepping the font down from 13px to 9px if the
 * wrapped text is still too tall. Whatever doesn't fit at the smallest size ends in "…".
 */
export function wrapLabel(text: string, width: number, height: number, ellipse = false): WrappedLabel {
  const box = innerBox(width, height, ellipse);
  let fallback: WrappedLabel | undefined;
  for (let fontSize = MAX_FONT; fontSize >= MIN_FONT; fontSize--) {
    const maxChars = Math.max(1, Math.floor(box.w / (fontSize * CHAR_W)));
    const lines = wrapAt(text.trim(), maxChars);
    const lineHeight = fontSize * LINE_H;
    if (lines.length * lineHeight <= box.h || lines.length === 1) return { lines, fontSize, lineHeight };
    fallback = { lines, fontSize, lineHeight };
  }
  const { fontSize, lineHeight } = fallback!;
  const maxLines = Math.max(1, Math.floor(box.h / lineHeight));
  const maxChars = Math.max(1, Math.floor(box.w / (fontSize * CHAR_W)));
  const lines = fallback!.lines.slice(0, maxLines);
  const last = lines[maxLines - 1] ?? '';
  lines[maxLines - 1] = `${last.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
  return { lines, fontSize, lineHeight };
}

/** Baseline-centred y for line `i` of a wrapped label centred on `cy`. */
export const lineY = (wrap: WrappedLabel, cy: number, i: number) => cy + (i - (wrap.lines.length - 1) / 2) * wrap.lineHeight;
