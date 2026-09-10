import { getCurrentSession } from './cognito';

export async function downloadAuthed(url: string, filename: string): Promise<void> {
  const session = await getCurrentSession();
  const res = await fetch(url, {
    headers: session?.isValid() ? { Authorization: `Bearer ${session.getIdToken().getJwtToken()}` } : {},
  });
  if (!res.ok) throw new Error(`Export failed: ${res.status}`);
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}
