import { embedBlock } from './embeds.js';

/**
 * First-run content: the sample diagram and welcome document a new user's first workspace
 * starts with. Shared so the API's POST /onboarding and the web client's fallback (used
 * when talking to an API that predates that route) create exactly the same thing.
 */

export const SAMPLE_DIAGRAM_NAME = 'Sample: web app architecture';

export const SAMPLE_DIAGRAM_DSL = `# Edit this code and choose "Apply to canvas", or drag things on the canvas.
direction LR
node users "Users"
node web "Web app"
node api "API service"
node db "Postgres"
node cache "Redis cache"
node jobs "Background jobs"
edge users -> web "HTTPS"
edge web -> api "REST"
edge api -> cache "cache-aside"
edge api -> db "SQL"
edge api -> jobs "enqueue"
group data "Data" { db cache }`;

export const WELCOME_TITLE = 'Welcome to Clara';

/** Markdown for the welcome document; embeds the sample diagram when its id is known. */
export function welcomeMarkdown(sampleDiagramId?: string): string {
  const embed = sampleDiagramId ? `\n${embedBlock({ id: sampleDiagramId, height: 320 })}\n` : '';
  return `Clara keeps your system design docs and diagrams together. This document is a normal markdown doc: edit it, or delete it when you're done.

## The sample diagram
${embed}
Open **${SAMPLE_DIAGRAM_NAME}** from the sidebar to try the canvas. A few things to try:

- **Double-click** a shape to rename it. Drag to move; arrows follow.
- Open the **Code** tab to edit the diagram as text, then **Apply to canvas**.
- Select a shape and choose **Create child** to drill down a level (C4 style).
- Add a **state** (for example "Target") above the canvas, change things, then press **Present**.

## Find anything

Press **⌘K** (Ctrl+K on Windows and Linux) to search documents and diagrams by title or tag, or to run a command. Press **?** for every keyboard shortcut.

## Work with others

- **Members** in the sidebar invites people to the workspace.
- **Share** on any document or diagram gives one person access, or creates a read-only public link.

## Let Claude help

Create an access token in **Settings → Access tokens** and connect Claude Code over MCP. Claude can read your docs and propose edits; they wait under **Pending changes** until someone accepts them.
`;
}
