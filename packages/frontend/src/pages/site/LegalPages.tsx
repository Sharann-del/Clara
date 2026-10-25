import { Link } from 'react-router-dom';
import { SiteLayout } from '../../components/site/SiteLayout';
import { usePageMeta } from '../../lib/seo';

const UPDATED = '24 October 2026';

export function PrivacyPage() {
  usePageMeta('Privacy', { description: 'What Clara stores, why, and for how long.' });
  return (
    <SiteLayout>
      <div className="page wrap">
        <div className="page-intro">
          <h1>Privacy</h1>
          <p className="muted">Last updated {UPDATED}</p>
        </div>
        <div className="longform">
          <p>
            This page explains what Clara stores when you use it and why. Clara is an early-access project; it does not
            sell data, show ads or use third-party analytics.
          </p>

          <h2>The playground</h2>
          <p>
            Diagrams you write at <Link to="/editor">/editor</Link> stay in your browser. A share link carries the
            diagram inside the part of the URL after <code>#</code>, which browsers never send to a server. Nothing
            reaches Clara's servers unless you choose <em>Save to Clara</em>.
          </p>

          <h2>Your account</h2>
          <ul>
            <li>
              <strong>Email address and password</strong>, managed by Amazon Cognito. Clara's own database never sees
              your password. Your email is used to sign you in, to send verification codes, and to show teammates who is
              in a workspace.
            </li>
            <li>
              <strong>Sign-in tokens</strong> are kept in your browser's local storage so you stay signed in. Signing
              out removes them.
            </li>
          </ul>

          <h2>What you create</h2>
          <p>
            Workspaces, folders, documents, diagrams, version history, sharing settings and pending AI changes are
            stored in a PostgreSQL database on AWS in Stockholm (eu-north-1). Each saved edit keeps the previous version
            so it can be restored. Personal access tokens are stored only as a one-way hash.
          </p>

          <h2>Live collaboration</h2>
          <p>
            While a document or diagram is open, a connection record (your user id, email and the item you're viewing)
            is kept in DynamoDB so updates reach other viewers. It is deleted when you leave and expires automatically
            within a few hours.
          </p>

          <h2>Logs</h2>
          <p>
            AWS keeps operational logs of API requests (for example, timestamps, paths and error messages) in CloudWatch
            for troubleshooting.
          </p>

          <h2>Third parties</h2>
          <ul>
            <li>
              <strong>Amazon Web Services</strong> hosts everything above.
            </li>
            <li>
              <strong>Google Fonts</strong> serves the typefaces this site uses, so your browser requests font files
              from Google.
            </li>
            <li>
              <strong>AI assistants you connect</strong> (such as Claude) receive whatever content they read through
              your personal access token, under that provider's own terms. You can revoke a token at any time in
              Settings.
            </li>
          </ul>

          <h2>Your choices</h2>
          <ul>
            <li>Export your documents as markdown and your diagrams as Mermaid, SVG, PNG or PDF at any time.</li>
            <li>Delete documents, diagrams and workspaces you own; revoke public links and tokens.</li>
            <li>To delete your account and everything only you own, contact the project team.</li>
          </ul>
        </div>
      </div>
    </SiteLayout>
  );
}

export function TermsPage() {
  usePageMeta('Terms', { description: 'The terms for using Clara during early access.' });
  return (
    <SiteLayout>
      <div className="page wrap">
        <div className="page-intro">
          <h1>Terms of use</h1>
          <p className="muted">Last updated {UPDATED}</p>
        </div>
        <div className="longform">
          <p>By creating an account or using Clara you agree to these terms.</p>

          <h2>Early access</h2>
          <p>
            Clara is provided free of charge, as is, during early access. Features may change, and the service may be
            unavailable at times. Keep your own exports of anything you can't afford to lose.
          </p>

          <h2>Your content</h2>
          <p>
            You own what you create. You give Clara permission to store, process and display it only as needed to run
            the service for you and the people you share it with, including through public links you create.
          </p>

          <h2>Acceptable use</h2>
          <ul>
            <li>
              Don't use Clara to store or share content that is illegal or that you don't have the right to share.
            </li>
            <li>Don't try to access workspaces, documents or accounts that aren't yours.</li>
            <li>Don't overload the service, including through automated clients or AI assistants.</li>
          </ul>

          <h2>AI assistants</h2>
          <p>
            A personal access token lets an assistant act as you, with your roles. You are responsible for the
            assistants you connect and for the changes you accept. Changes proposed by an assistant are not applied
            until someone accepts them.
          </p>

          <h2>Accounts</h2>
          <p>
            Keep your password and tokens private. We may suspend accounts that break these terms or put the service at
            risk.
          </p>

          <h2>Liability</h2>
          <p>
            To the extent the law allows, Clara and its builders are not liable for lost data, lost profits or indirect
            damages arising from use of the service.
          </p>

          <h2>Changes</h2>
          <p>
            We'll update this page when the terms change. Continuing to use Clara after an update means you accept it.
          </p>
        </div>
      </div>
    </SiteLayout>
  );
}
