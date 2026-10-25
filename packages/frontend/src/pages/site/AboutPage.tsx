import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { SiteLayout } from '../../components/site/SiteLayout';
import { DiagramViewer } from '../../components/DiagramViewer';
import { usePageMeta } from '../../lib/seo';
import { compileDiagram } from '../../lib/diagramFromCode';
import { EXAMPLES } from '../../lib/examples';

export function AboutPage() {
  usePageMeta('About', { description: 'Why Clara exists, who builds it, and how it runs on AWS.' });
  const aws = EXAMPLES.find((e) => e.id === 'clara-aws')!;
  const elements = useMemo(() => compileDiagram(aws.code, aws.format).elements, [aws]);
  return (
    <SiteLayout>
      <div className="page wrap">
        <div className="page-intro">
          <span className="eyebrow">node clara "About"</span>
          <h1>Design docs should be as easy to change as the system they describe.</h1>
        </div>
        <div className="longform">
          <p>
            Most architecture documentation goes stale the week after it's written. The diagram lives in a drawing tool,
            the reasoning in a doc, the latest decision in a chat thread, and nobody wants to redraw boxes to keep them
            in step.
          </p>
          <p>
            Clara puts the doc and the diagram in one place and makes the diagram editable as text, so updating it is as
            quick as editing a paragraph. Diagrams nest, so one overview can lead to as much detail as a reader needs.
            And because the whole model is available to AI assistants over the Model Context Protocol, Claude can do the
            tedious updates for you, with a person approving every change.
          </p>

          <h2>Who builds it</h2>
          <p>
            Clara is built by Sharann and Dhriti as a cloud architecture course project. The goal was a real product
            rather than a demo: something we would use for our own design docs, deployed on a genuinely multi-service
            AWS setup.
          </p>

          <h2>How it runs</h2>
          <p>
            Everything runs in one AWS region (Stockholm). The diagram below is Clara's own architecture, written in
            Mermaid and rendered by Clara. You can open it in the <Link to={`/editor`}>playground</Link> from the
            examples menu.
          </p>
        </div>
        <div className="feature-visual" style={{ height: 420, marginTop: 20 }}>
          <div className="visual-body">
            <DiagramViewer elements={elements} className="viewer-inline" label="Clara's AWS architecture" />
          </div>
        </div>
        <div className="longform">
          <ul>
            <li>
              <strong>CloudFront and S3</strong> serve this site.
            </li>
            <li>
              <strong>Amazon Cognito</strong> handles accounts and sign-in.
            </li>
            <li>
              <strong>API Gateway and Lambda</strong> run the REST API, the MCP server and the real-time WebSocket
              handlers.
            </li>
            <li>
              <strong>RDS for PostgreSQL</strong> stores workspaces, documents, diagrams, versions and pending AI
              changes.
            </li>
            <li>
              <strong>DynamoDB</strong> tracks who is connected to which document, so live updates reach the right
              people.
            </li>
          </ul>

          <h2>What we care about</h2>
          <ul>
            <li>
              <strong>Text first.</strong> Every diagram can be written, diffed and exported as text.
            </li>
            <li>
              <strong>People approve.</strong> AI assistants propose; humans decide. Nothing is applied behind your
              back.
            </li>
            <li>
              <strong>No lock-in.</strong> Markdown out, Mermaid out, SVG, PNG and PDF out.
            </li>
          </ul>
        </div>
      </div>
    </SiteLayout>
  );
}
