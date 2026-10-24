/** Only same-site paths are allowed as a post-sign-in redirect (no `//evil.com`, no absolute URLs). */
export function safeNext(raw: string | null | undefined, fallback = '/app'): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return fallback;
  return raw;
}
