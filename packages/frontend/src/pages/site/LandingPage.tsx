import { Link } from 'react-router-dom';
import { SiteLayout } from '../../components/site/SiteLayout';
import { Icon } from '../../components/ui/Icon';
import { usePageMeta } from '../../lib/seo';
import { api } from '../../lib/api';
import { HeroDemo } from './HeroDemo';
import { C4Visual, CodeVisual, CollabVisual, DocsVisual, McpVisual, StatesVisual } from './LandingVisuals';

const FAQ: { q: string; a: string }[] = [
  {
    q: 'Do I need an account to try it?',
    a: 'No. The playground at /editor works without signing in: write Clara DSL or Mermaid, export SVG, PNG or PDF, and share a link that carries the whole diagram in the URL. Sign in when you want to save it to a workspace.',
  },
  {
    q: 'Can Claude change my documents without me noticing?',
    a: 'No. Every write that arrives over MCP is stored as a pending change with a diff. Nothing touches your documents or diagrams until someone with editor access accepts it, and the accepted change is applied as that person, with the previous version saved to history.',
  },
  {
    q: 'What Mermaid syntax is supported?',
    a: 'Flowcharts: flowchart/graph headers with a direction, node shapes like A[Box], A(Round) and A([Stadium]), edges with or without |labels|, and semicolon-separated statements. Subgraphs, styling and other diagram types are reported as skipped lines rather than silently dropped.',
  },
  {
    q: 'Is a diagram code or a drawing?',
    a: 'Both. Write code and Clara lays it out; then drag, resize and annotate on the canvas. You can export any diagram back to Mermaid, and arrows stay attached to their shapes when you move them.',
  },
  {
    q: 'How does sharing work?',
    a: 'Invite people to a workspace as admin, editor or viewer, share a single document or diagram with someone outside the workspace, or create a read-only public link you can revoke at any time.',
  },
  {
    q: 'Where is my data stored?',
    a: 'In a PostgreSQL database on AWS in Stockholm (eu-north-1), behind sign-in with Amazon Cognito. Playground diagrams never leave your browser unless you save them or share the link.',
  },
];

export function LandingPage() {
  usePageMeta('');
  return (
    <SiteLayout>
      <section className="hero" aria-labelledby="hero-title">
        <div className="wrap">
          <div className="hero-copy">
            <h1 id="hero-title" className="display">
              <mark className="hl">System design</mark> you can <em>type</em>, zoom into, and hand to Claude.
            </h1>
            <p className="lede">
              Clara keeps architecture docs and diagrams in one place. Write a diagram as code, drill from the whole
              system down to a single service, walk people through how it changes, and let AI assistants propose edits
              that land only when you approve them.
            </p>
            <div className="cta-row">
              <Link to="/editor" className="btn btn-primary btn-lg">
                Open the playground <Icon name="arrowRight" />
              </Link>
              <Link to="/signup" className="btn btn-lg">
                Create a free account
              </Link>
            </div>
            <p className="hero-note">The playground needs no sign-in. Try editing the code below.</p>
          </div>
          <HeroDemo />
        </div>
      </section>

      <section className="features wrap" aria-labelledby="features-title">
        <div className="features-intro">
          <h2 id="features-title" className="section-title">
            <mark className="hl">One place</mark> for the doc, the diagram, and the decision.
          </h2>
          <p className="lede" style={{ marginBottom: 0 }}>
            Design docs rot when the diagram lives in one tool and the reasoning in another. Clara keeps them together
            and keeps them editable as text.
          </p>
        </div>

        <article className="feature">
          <div>
            <span className="eyebrow">```clara-diagram</span>
            <h3>Docs and diagrams, side by side</h3>
            <p>
              Write in markdown, switch to a rich-text view when you prefer, and drop a diagram straight into the page.
              The embed renders the diagram live, so the doc never shows a stale screenshot.
            </p>
            <ul className="feature-points">
              <li>Folders and tags across documents and diagrams</li>
              <li>Full version history with a preview before you restore</li>
              <li>Export documents as markdown</li>
            </ul>
          </div>
          <DocsVisual />
        </article>

        <article className="feature">
          <div>
            <span className="eyebrow">edge api -&gt; db "SQL"</span>
            <h3>Diagrams as code, and back again</h3>
            <p>
              Describe nodes, edges and groups in a few lines of Clara DSL, or paste a Mermaid flowchart. Clara lays it
              out automatically and gives you an editable canvas, and exports back to Mermaid whenever you need it
              elsewhere.
            </p>
            <ul className="feature-points">
              <li>Top-down or left-to-right layout</li>
              <li>Skipped lines are pointed out, never silently dropped</li>
              <li>SVG, PNG and PDF export</li>
            </ul>
          </div>
          <CodeVisual />
        </article>

        <article className="feature">
          <div>
            <span className="eyebrow">linkedDiagramId</span>
            <h3>Drill down as deep as the system goes</h3>
            <p>
              Link any shape to a child diagram. Context links to containers, containers to components, and there is no
              fixed depth. Readers click through; the breadcrumb always shows where they are.
            </p>
            <ul className="feature-points">
              <li>Link to an existing diagram or create a new child</li>
              <li>Works for C4 or any hierarchy you use</li>
            </ul>
          </div>
          <C4Visual />
        </article>

        <article className="feature">
          <div>
            <span className="eyebrow">state "Migrating"</span>
            <h3>Explain how the system changes</h3>
            <p>
              Give one diagram named states such as today, migrating and target. Each state shows, hides, moves or
              restyles elements. Step through them in a meeting, or let them play on a timer.
            </p>
            <ul className="feature-points">
              <li>Present mode with smooth transitions</li>
              <li>Edits made in a state never touch the base diagram</li>
            </ul>
          </div>
          <StatesVisual />
        </article>

        <article className="feature">
          <div>
            <span className="eyebrow">presence.joined</span>
            <h3>Edit together, live</h3>
            <p>
              See who else is in a document or diagram, follow their cursors, and watch shapes move as they drag them.
              Two people editing different shapes never get in each other's way.
            </p>
            <ul className="feature-points">
              <li>Workspace roles: owner, admin, editor, viewer</li>
              <li>Share single items or publish a read-only link</li>
            </ul>
          </div>
          <CollabVisual />
        </article>

        <article className="feature">
          <div>
            <span className="eyebrow">status: pending_review</span>
            <h3>AI edits over MCP, with a human in the loop</h3>
            <p>
              Connect Claude Code or any MCP client with a personal access token. It can read what you can read, and
              when it writes, the change waits as a diff for someone on your team to accept or reject.
            </p>
            <ul className="feature-points">
              <li>Same roles as the web app; a token carries no extra power</li>
              <li>
                <Link to="/docs/mcp">Set it up in two minutes</Link>
              </li>
            </ul>
          </div>
          <McpVisual mcpUrl={api.mcpUrl} />
        </article>
      </section>

      <section className="review-section" aria-labelledby="review-title">
        <div className="wrap">
          <span className="eyebrow">propose → review → apply</span>
          <h2 id="review-title" className="section-title">
            How <mark className="hl">MCP review</mark> works
          </h2>
          <p className="lede" style={{ marginBottom: 0 }}>
            An assistant never writes to your workspace directly. Every change goes through the same four steps.
          </p>
          <ol className="steps">
            <li className="step">
              <h3>Claude proposes</h3>
              <p>
                It calls a tool such as update_diagram or create_document with your token. Clara checks you have editor
                access.
              </p>
            </li>
            <li className="step pending">
              <h3>Clara stages a diff</h3>
              <p>
                The proposal is saved as a pending change with a snapshot of what it was based on. Nothing else is
                touched.
              </p>
            </li>
            <li className="step pending">
              <h3>A person reviews</h3>
              <p>
                Line diffs for documents; added, changed and removed shapes for diagrams. Stale proposals are flagged.
              </p>
            </li>
            <li className="step done">
              <h3>Accept or reject</h3>
              <p>
                Accepting applies it as the reviewer and saves the previous version to history. Rejecting discards it.
              </p>
            </li>
          </ol>
          <div className="review-facts">
            <div className="review-fact">
              <strong>Never stale by accident</strong>
              If someone edited the doc after the proposal, Clara shows the diff against the current version and asks
              before overwriting.
            </div>
            <div className="review-fact">
              <strong>Always reversible</strong>
              Every accepted change can be rolled back from version history, like any human edit.
            </div>
            <div className="review-fact">
              <strong>Bounded</strong>
              Viewers can't propose; there's a cap on open proposals per person, so an assistant can't flood the queue.
            </div>
          </div>
        </div>
      </section>

      <section className="faq wrap" aria-labelledby="faq-title">
        <div>
          <h2 id="faq-title" className="section-title">
            Questions
          </h2>
          <p className="muted" style={{ fontSize: 14 }}>
            More in the <Link to="/docs">docs</Link>.
          </p>
        </div>
        <div className="faq-list">
          {FAQ.map((f) => (
            <details key={f.q}>
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <div className="wrap">
        <section className="closing" aria-labelledby="closing-title">
          <div>
            <h2 id="closing-title">
              Write the system down once. <mark className="hl">Keep it true.</mark>
            </h2>
            <p>Free while Clara is in early access. No card needed.</p>
          </div>
          <div className="cta-row">
            <Link to="/signup" className="btn btn-primary btn-lg">
              Create a free account
            </Link>
            <Link to="/editor" className="btn btn-lg">
              Try the playground
            </Link>
          </div>
        </section>
      </div>
    </SiteLayout>
  );
}
