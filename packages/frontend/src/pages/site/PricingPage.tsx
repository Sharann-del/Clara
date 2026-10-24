import { Link } from 'react-router-dom';
import { SiteLayout } from '../../components/site/SiteLayout';
import { Icon } from '../../components/ui/Icon';
import { usePageMeta } from '../../lib/seo';

const INCLUDED = [
  'Unlimited workspaces, documents and diagrams',
  'Diagram-as-code (Clara DSL) and Mermaid import/export',
  'C4 drill-down with unlimited depth',
  'Named states and present mode',
  'Real-time editing, cursors and presence',
  'MCP access for Claude, with change review',
  'Version history and restore',
  'SVG, PNG, PDF and markdown export',
  'Workspace roles, per-item sharing and public links',
];

const LIMITS: [string, string][] = [
  ['Open AI proposals', '50 awaiting review per person, per workspace'],
  ['Personal access tokens', '20 active per person; expire after 30, 90 or 365 days, or never'],
  ['Diagram size via MCP', '1,000 elements per proposal'],
  ['Document size via MCP', '500,000 characters per proposal'],
  ['Playground', 'No limits; nothing is stored on our servers'],
];

export function PricingPage() {
  usePageMeta('Pricing', { description: 'Clara is free during early access: every feature, every workspace, no card needed.' });
  return (
    <SiteLayout>
      <div className="page wrap">
        <div className="page-intro">
          <span className="eyebrow">price: 0</span>
          <h1>Free while Clara is in early access.</h1>
          <p className="lede">
            Every feature is included for everyone. The few limits below exist to keep the service healthy, not to push you to
            an upgrade.
          </p>
        </div>

        <div className="plans" style={{ gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)' }}>
          <section className="plan featured" aria-labelledby="plan-free">
            <h2 id="plan-free">Early access</h2>
            <div className="plan-price">
              $0 <small>per person, per month</small>
            </div>
            <ul style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
              {INCLUDED.map((f) => (
                <li key={f}>
                  <Icon name="check" size={15} /> {f}
                </li>
              ))}
            </ul>
            <div className="cta-row">
              <Link to="/signup" className="btn btn-primary btn-lg">
                Create a free account
              </Link>
              <Link to="/editor" className="btn btn-lg">
                Try without an account
              </Link>
            </div>
          </section>
          <section className="plan" aria-labelledby="plan-later">
            <h2 id="plan-later">If that changes</h2>
            <p style={{ margin: 0, color: 'var(--ink-2)', lineHeight: 1.65 }}>
              If paid plans are ever introduced, they'll be announced well in advance on this page, and you'll always be able to
              export your documents as markdown and your diagrams as Mermaid, SVG, PNG or PDF.
            </p>
            <p style={{ margin: 0, color: 'var(--ink-2)', lineHeight: 1.65 }}>
              Clara is built as a cloud architecture project and runs on a small AWS footprint. The{' '}
              <Link to="/about">about page</Link> explains how.
            </p>
          </section>
        </div>

        <section style={{ marginTop: 56, maxWidth: 760 }} aria-labelledby="limits-title">
          <h2 id="limits-title" className="section-title" style={{ fontSize: '1.6rem' }}>
            Fair-use limits
          </h2>
          <table className="limits-table">
            <tbody>
              {LIMITS.map(([k, v]) => (
                <tr key={k}>
                  <th scope="row">{k}</th>
                  <td>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </SiteLayout>
  );
}
