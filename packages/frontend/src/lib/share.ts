/**
 * Playground state <-> URL hash, so a diagram can be shared with no server round trip
 * (like mermaid.live). `#z=` is deflate-raw + base64url via the built-in CompressionStream;
 * `#t=` is plain UTF-8 base64url for browsers without it. Both are accepted on read.
 */
export type CodeFormat = 'clara' | 'mermaid';

export interface PlaygroundState {
  code: string;
  format: CodeFormat;
}

/** Hard cap so a pasted URL can't make us inflate something enormous. */
const MAX_CODE_CHARS = 200_000;

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

const hasCompression = () => typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

export async function encodeState(state: PlaygroundState): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify({ c: state.code, f: state.format === 'mermaid' ? 'm' : 'c' }));
  if (hasCompression()) return `z=${toBase64Url(await pipe(json, new CompressionStream('deflate-raw')))}`;
  return `t=${toBase64Url(json)}`;
}

/** Parses a location hash (with or without the leading `#`); undefined if absent or malformed. */
export async function decodeState(hash: string): Promise<PlaygroundState | undefined> {
  const m = hash.replace(/^#/, '').match(/^([zt])=([A-Za-z0-9_-]+)$/);
  if (!m) return undefined;
  try {
    let bytes = fromBase64Url(m[2]);
    if (m[1] === 'z') {
      if (!hasCompression()) return undefined;
      bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
    }
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as { c?: unknown; f?: unknown };
    if (typeof parsed.c !== 'string' || parsed.c.length > MAX_CODE_CHARS) return undefined;
    return { code: parsed.c, format: parsed.f === 'm' ? 'mermaid' : 'clara' };
  } catch {
    return undefined;
  }
}

/** Mermaid sources start with a flowchart/graph header; anything else is treated as Clara DSL. */
export function detectFormat(code: string): CodeFormat {
  const first = code.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('%%') && !l.startsWith('#'));
  return first && /^(flowchart|graph)\b/i.test(first) ? 'mermaid' : 'clara';
}
