import type { ReactNode } from 'react';
import { Link, NavLink, Navigate, useParams } from 'react-router-dom';
import { SiteLayout } from '../../components/site/SiteLayout';
import { ShortcutList } from '../../components/ShortcutList';
import { usePageMeta } from '../../lib/seo';
import { api } from '../../lib/api';

interface Section {
  slug: string;
  title: string;
  description: string;
  body: () => ReactNode;
}

const Code = ({ children }: { children: string }) => (
  <pre>
    <code>{children}</code>
  </pre>
);

const SECTIONS: Section[] = [
  {
    slug: 'getting-started',
    title: 'Getting started',
    description: 'Create a workspace, write your first document and diagram, and invite your team.',
    body: () => (
      <>
        <p>
          Clara organizes everything into <strong>workspaces</strong>. A workspace holds folders, markdown documents and
          diagrams, and has members with roles. When you sign up, Clara creates a first workspace with a welcome
          document and a sample diagram so you have something to poke at.
        </p>
        <h2>Try it without an account</h2>
        <p>
          The <Link to="/editor">playground</Link> renders Clara DSL or Mermaid as you type, exports SVG, PNG and PDF,
          and makes share links that contain the whole diagram. <em>Save to Clara</em> copies it into a workspace once
          you sign in.
        </p>
        <h2>Documents</h2>
        <p>
          Documents are markdown. Use the Source view for raw markdown or the Rich view to edit formatted text; the
          toolbar handles headings, lists, links, code, tables and images. Clara saves as you type and keeps a version
          for every save, so you can preview and restore any earlier state from <em>History</em>.
        </p>
        <h3>Embedding a diagram</h3>
        <p>
          Choose <em>Insert diagram</em> in the editor toolbar and pick a diagram from the workspace. Clara adds a block
          like this, which renders the live diagram in the Rich view and in shared links:
        </p>
        <Code>{'```clara-diagram\nid: 3f0c8f8e-5f0a-4a3b-9e57-0d7a2a1f1c42\nheight: 360\n```'}</Code>
        <p>
          <code>height</code> is optional (in pixels). The embed always shows the diagram's current version.
        </p>
        <h2>Diagrams</h2>
        <p>
          Draw on the canvas with the toolbar (rectangle, ellipse, text, connector) or write code on the <em>Code</em>{' '}
          tab and apply it. Connectors attach to shapes, so they follow when you move things. Double-click a shape to
          edit its text.
        </p>
        <h3>Drill-down (C4)</h3>
        <p>
          Select a shape and choose <em>Link to diagram</em> to point it at an existing diagram, or{' '}
          <em>Create child</em> to make a new one. Linked shapes show a corner badge; double-click to open the child.
          The breadcrumb shows the path back up. There's no depth limit.
        </p>
        <h3>States and present mode</h3>
        <p>
          Add named states (for example "Today", "Migrating", "Target") above the canvas. While a state is selected,
          moves, style changes, hides and new shapes apply only to that state. <em>Present</em> steps through Base and
          each state with animated transitions; press Space for auto-play.
        </p>
        <h2>Working with others</h2>
        <ul>
          <li>
            <strong>Workspace members</strong>: owners and admins invite people by email as admin, editor or viewer.
          </li>
          <li>
            <strong>Share one item</strong>: the <em>Share</em> button on a document or diagram grants a specific person
            access to just that item.
          </li>
          <li>
            <strong>Public link</strong>: create a read-only link anyone can open without signing in. Revoke it any time
            from the same dialog.
          </li>
        </ul>
        <table>
          <thead>
            <tr>
              <th>Role</th>
              <th>Can</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Viewer</td>
              <td>Read, export, present</td>
            </tr>
            <tr>
              <td>Editor</td>
              <td>Everything a viewer can, plus create, edit, delete, and review AI changes</td>
            </tr>
            <tr>
              <td>Admin</td>
              <td>Everything an editor can, plus manage members</td>
            </tr>
            <tr>
              <td>Owner</td>
              <td>Everything, including deleting the workspace</td>
            </tr>
          </tbody>
        </table>
      </>
    ),
  },
  {
    slug: 'dsl',
    title: 'Clara DSL reference',
    description: 'The line-based language for writing diagrams as code.',
    body: () => (
      <>
        <p>
          Clara DSL is one statement per line. Clara lays the result out automatically (with Dagre), so you only
          describe what connects to what.
        </p>
        <Code>{`# Lines starting with # are comments
direction LR

node browser "Browser"
node api "Orders API"
node db "Postgres"

edge browser -> api "HTTPS"
edge api -> db "SQL"

group backend "Backend" { api db }`}</Code>
        <h2>Statements</h2>
        <table>
          <thead>
            <tr>
              <th>Statement</th>
              <th>Meaning</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>node &lt;id&gt; ["Label"]</code>
              </td>
              <td>A box. The id is any text without spaces; the label defaults to the id.</td>
            </tr>
            <tr>
              <td>
                <code>edge &lt;from&gt; -&gt; &lt;to&gt; ["Label"]</code>
              </td>
              <td>An arrow between two declared nodes, with an optional label.</td>
            </tr>
            <tr>
              <td>
                <code>group &lt;id&gt; "Label" {'{ a b c }'}</code>
              </td>
              <td>A dashed frame drawn around the listed nodes.</td>
            </tr>
            <tr>
              <td>
                <code>direction TB|LR|BT|RL</code>
              </td>
              <td>Layout direction: top-to-bottom (default), left-to-right, and so on.</td>
            </tr>
          </tbody>
        </table>
        <h2>Errors</h2>
        <p>
          Lines Clara can't read are listed under the editor with their line numbers, and so are edges that name a node
          that was never declared. Nothing is silently dropped.
        </p>
        <h2>Code and canvas</h2>
        <p>
          Applying code replaces the diagram's shapes with a fresh layout (the previous version goes to history). After
          that, adjust freely on the canvas. To get code back out, use <em>Export → Mermaid</em>.
        </p>
      </>
    ),
  },
  {
    slug: 'mermaid',
    title: 'Mermaid support',
    description: 'Which Mermaid flowchart syntax Clara imports and exports.',
    body: () => (
      <>
        <p>
          Clara imports Mermaid <strong>flowcharts</strong> into editable canvas diagrams and exports any diagram back
          to a Mermaid flowchart.
        </p>
        <h2>Supported on import</h2>
        <Code>{`flowchart LR
  A[Box] --> B(Rounded)
  B -->|label| C([Stadium])
  C --> D[(Database)]; D --> E
  F["Quoted label"]`}</Code>
        <ul>
          <li>
            <code>flowchart</code> or <code>graph</code> headers, with direction <code>TD</code>, <code>TB</code>,{' '}
            <code>LR</code>, <code>BT</code> or <code>RL</code>
          </li>
          <li>
            Node labels in <code>[ ]</code>, <code>( )</code>, <code>{'{ }'}</code>, <code>([ ])</code> and{' '}
            <code>[( )]</code>, quoted or not
          </li>
          <li>
            Arrows <code>--&gt;</code>, <code>---&gt;</code>, with optional <code>|label|</code>
          </li>
          <li>Standalone node declarations, one statement per line or separated by semicolons</li>
          <li>
            <code>%%</code> comments
          </li>
        </ul>
        <h2>Not supported yet</h2>
        <p>
          Subgraphs, <code>classDef</code>/<code>style</code>, click handlers, chained edges (
          <code>A --&gt; B --&gt; C</code>), and non-flowchart diagram types. The editor lists these lines as skipped so
          you can see what was left out.
        </p>
        <h2>Export</h2>
        <p>
          <em>Export → Mermaid source</em> writes a <code>flowchart TD</code> with one declaration per shape (ellipses
          become stadiums) and one edge per connector. Connectors that point at text or groups have no Mermaid
          equivalent and are left out.
        </p>
      </>
    ),
  },
  {
    slug: 'mcp',
    title: 'MCP setup guide',
    description: 'Connect Claude Code (or any MCP client) to Clara and review its changes.',
    body: () => (
      <>
        <p>
          Clara runs a Model Context Protocol server, so an AI assistant can read your documents and diagrams and
          propose changes. Proposals wait for a person to review them under <em>Pending changes</em>; nothing is applied
          automatically.
        </p>
        <h2>1. Create a token</h2>
        <p>
          Sign in, open <Link to="/settings/tokens">Settings → Access tokens</Link>, name the token (for example "Claude
          Code on my laptop") and choose an expiry. Copy it right away; Clara only stores a hash and can't show it
          again.
        </p>
        <h2>2. Add the server to Claude Code</h2>
        <Code>{`claude mcp add --transport http clara ${api.mcpUrl} \\
  --header "Authorization: Bearer clara_pat_YOUR_TOKEN"`}</Code>
        <p>
          Run <code>claude mcp list</code> to check it connected. Any MCP client that speaks streamable HTTP and can
          send an <code>Authorization</code> header works the same way. The server is stateless and answers JSON over{' '}
          <code>POST</code>.
        </p>
        <div className="callout">
          claude.ai's custom connectors expect OAuth, which Clara doesn't offer yet. Use Claude Code or another client
          that supports a bearer token header.
        </div>
        <h2>3. Ask for something</h2>
        <Code>{`> List my Clara workspaces
> Read the "Checkout" diagram and add a CDN in front of the storefront
> Import this Mermaid as a new diagram called "Payments" in the Platform workspace`}</Code>
        <h2>4. Review</h2>
        <p>
          Open the workspace in Clara and choose <em>Pending changes</em> (the badge shows how many are waiting). Each
          change shows a line diff for documents, or added, changed and removed shapes for diagrams. <em>Accept</em>{' '}
          applies it as you and saves the previous version to history; <em>Reject</em> discards it. If the item changed
          since the proposal, Clara warns you and shows the diff against the current version first.
        </p>
        <h2>Tools</h2>
        <table>
          <thead>
            <tr>
              <th>Tool</th>
              <th>What it does</th>
            </tr>
          </thead>
          <tbody>
            {[
              ['list_workspaces', 'Workspaces you belong to, with your role'],
              ['list_documents / read_document', 'Document titles, tags, folders; full markdown'],
              [
                'create_document / update_document',
                'Propose a new document or an edit (full body or find/replace edits)',
              ],
              ['list_diagrams / read_diagram', 'Diagram list; elements, source code and child diagrams'],
              ['create_diagram / update_diagram', 'Propose a new diagram, or add/modify/remove elements'],
              ['import_mermaid', 'Propose a diagram built from Mermaid source'],
              ['traverse_diagram_hierarchy', 'Walk the C4 drill-down tree up and down'],
              ['list_my_proposals', 'Whether your proposals are pending, accepted or rejected'],
            ].map(([t, d]) => (
              <tr key={t}>
                <td>
                  <code>{t}</code>
                </td>
                <td>{d}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h2>Permissions</h2>
        <p>
          A token acts as you, with your current roles. It can read whatever you can read; it can propose changes only
          where you are an editor; and if your access changes, the token's does too. Revoke tokens from the same
          settings page.
        </p>
      </>
    ),
  },
  {
    slug: 'shortcuts',
    title: 'Keyboard shortcuts',
    description: 'Every keyboard shortcut in Clara.',
    body: () => (
      <>
        <p>
          Press <kbd>?</kbd> anywhere in the app to see these without leaving the page.
        </p>
        <ShortcutList />
      </>
    ),
  },
];

export function DocsPage() {
  const { section } = useParams<{ section?: string }>();
  const index = SECTIONS.findIndex((s) => s.slug === (section ?? 'getting-started'));
  const current = SECTIONS[index];
  usePageMeta(current ? `${current.title} · Docs` : 'Docs', { description: current?.description });
  if (!current) return <Navigate to="/docs" replace />;
  const prev = SECTIONS[index - 1];
  const next = SECTIONS[index + 1];

  return (
    <SiteLayout>
      <div className="docs wrap">
        <nav className="docs-nav" aria-label="Documentation">
          <h2>Documentation</h2>
          {SECTIONS.map((s) => (
            <NavLink
              key={s.slug}
              to={`/docs/${s.slug}`}
              className={() => (s.slug === current.slug ? 'active' : '')}
              aria-current={s.slug === current.slug ? 'page' : undefined}
            >
              {s.title}
            </NavLink>
          ))}
        </nav>
        <article className="docs-body longform">
          <h1>{current.title}</h1>
          {current.body()}
          <nav className="docs-pager" aria-label="Previous and next">
            {prev ? (
              <Link to={`/docs/${prev.slug}`}>
                <span>Previous</span>
                {prev.title}
              </Link>
            ) : (
              <span />
            )}
            {next && (
              <Link to={`/docs/${next.slug}`} style={{ textAlign: 'right' }}>
                <span>Next</span>
                {next.title}
              </Link>
            )}
          </nav>
        </article>
      </div>
    </SiteLayout>
  );
}
