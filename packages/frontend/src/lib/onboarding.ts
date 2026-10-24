import { layoutToElements, parseClaraDsl } from '@clara/shared/dsl';
import { SAMPLE_DIAGRAM_DSL, SAMPLE_DIAGRAM_NAME, WELCOME_TITLE, welcomeMarkdown } from '@clara/shared/onboarding';
import { api, isMissingRoute, type OnboardingResult } from './api';

let inflight: Promise<OnboardingResult> | null = null;

/**
 * First-run setup: a workspace with a welcome doc and a sample diagram, at most once per account.
 * POST /onboarding decides that server-side. Against an older API without the route, the same
 * content is created with regular endpoints, remembered per account in this browser.
 * Concurrent calls share one request.
 */
export function ensureOnboarded(userKey: string): Promise<OnboardingResult> {
  inflight ??= run(userKey).finally(() => {
    inflight = null;
  });
  return inflight;
}

async function run(userKey: string): Promise<OnboardingResult> {
  try {
    return await api.onboard();
  } catch (err) {
    if (!isMissingRoute(err)) throw err;
  }
  const flag = `clara.onboarded.${userKey}`;
  const existing = await api.listWorkspaces();
  let done = false;
  try {
    done = localStorage.getItem(flag) === '1';
    localStorage.setItem(flag, '1');
  } catch {
    // no storage: fall back to "has workspaces"
  }
  if (existing.length > 0 || done) return { created: false, workspaceId: existing[0]?.id ?? null };
  const ws = await api.createWorkspace('My workspace');
  const diagram = await api.createDiagram(ws.id, SAMPLE_DIAGRAM_NAME);
  await api.saveDiagramElements(diagram.id, layoutToElements(parseClaraDsl(SAMPLE_DIAGRAM_DSL)));
  await api.setDiagramSource(diagram.id, SAMPLE_DIAGRAM_DSL, 'clara');
  await api.updateDiagram(diagram.id, { tags: ['sample'] });
  const doc = await api.createDocument(ws.id, WELCOME_TITLE);
  await api.updateDocument(doc.id, { contentMd: welcomeMarkdown(diagram.id), tags: ['getting-started'] });
  return { created: true, workspaceId: ws.id, documentId: doc.id, diagramId: diagram.id };
}
