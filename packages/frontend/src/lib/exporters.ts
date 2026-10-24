import { renderDiagramSvg, type RenderableElement } from '@clara/shared/render';
import { toMermaid } from '@clara/shared/dsl';
import { jpegToPdf } from './pdf';

export type ExportFormat = 'svg' | 'png' | 'pdf' | 'mermaid';

/** Filesystem-safe base name. */
export function fileBase(name: string): string {
  return (name.trim() || 'diagram').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120);
}

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Rasterizes a standalone SVG string at `scale`× onto a canvas with the given background. */
async function rasterize(svg: string, width: number, height: number, scale: number, background: string | null) {
  // Browsers cap canvas area (~16k px per side / ~268M px total); keep well inside it.
  const maxSide = 8000;
  const s = Math.min(scale, maxSide / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * s));
  canvas.height = Math.max(1, Math.round(height * s));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available in this browser');
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Could not render the diagram image'));
      img.src = url;
    });
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  } finally {
    URL.revokeObjectURL(url);
  }
  return canvas;
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Image encoding failed'))), type, quality),
  );

/**
 * Client-side export of what's on screen (pass the state-resolved elements; hidden ones
 * are skipped). Always rendered light-on-white so exports look the same in dark mode.
 */
export async function exportDiagram(elements: RenderableElement[], name: string, format: ExportFormat): Promise<void> {
  const base = fileBase(name);
  if (format === 'mermaid') {
    saveBlob(new Blob([toMermaid(elements.filter((e) => !e.hidden))], { type: 'text/plain;charset=utf-8' }), `${base}.mmd`);
    return;
  }
  const { svg, width, height } = renderDiagramSvg(elements, { xmlProlog: format === 'svg' });
  if (format === 'svg') {
    saveBlob(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), `${base}.svg`);
    return;
  }
  if (format === 'png') {
    const canvas = await rasterize(svg, width, height, 2, null);
    saveBlob(await toBlob(canvas, 'image/png'), `${base}.png`);
    return;
  }
  // PDF: a 2× JPEG on a page the diagram's size (1 CSS px = 0.75 pt).
  const canvas = await rasterize(svg, width, height, 2, '#ffffff');
  const jpeg = new Uint8Array(await (await toBlob(canvas, 'image/jpeg', 0.92)).arrayBuffer());
  const pdf = jpegToPdf(jpeg, canvas.width, canvas.height, width * 0.75, height * 0.75);
  saveBlob(new Blob([pdf], { type: 'application/pdf' }), `${base}.pdf`);
}
