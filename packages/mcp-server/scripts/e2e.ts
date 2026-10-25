// End-to-end test of the MCP server against the DEPLOYED stack.
//
//   npm run e2e -w @clara/mcp-server
//
// Creates four throwaway Cognito users (owner/editor/viewer/outsider), a throwaway
// workspace, and a personal access token per user via the real REST API, then runs
// the shared scenario (scripts/scenario.ts) over HTTP against POST /mcp. Everything
// is deleted afterwards. Uses only self-service + single-user Cognito calls
// (sign-up, admin-confirm-sign-up, initiate-auth, admin-delete-user).
//
// Config comes from env (API_URL, MCP_URL, USER_POOL_ID, USER_POOL_CLIENT_ID,
// AWS_REGION) or, if unset, from the ClaraStack CloudFormation outputs.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  AdminConfirmSignUpCommand,
  AdminDeleteUserCommand,
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  SignUpCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { runScenario, type Driver, type Persona } from './scenario.js';

const region = process.env.AWS_REGION ?? 'eu-north-1';

function stackOutputs(): Record<string, string> {
  const out = execFileSync(
    'aws',
    [
      'cloudformation',
      'describe-stacks',
      '--stack-name',
      'ClaraStack',
      '--region',
      region,
      '--query',
      'Stacks[0].Outputs',
      '--output',
      'json',
    ],
    { encoding: 'utf8' },
  );
  return Object.fromEntries(
    (JSON.parse(out) as { OutputKey: string; OutputValue: string }[]).map((o) => [o.OutputKey, o.OutputValue]),
  );
}

const needed = ['API_URL', 'MCP_URL', 'USER_POOL_ID', 'USER_POOL_CLIENT_ID'] as const;
const env: Record<string, string> = Object.fromEntries(needed.map((k) => [k, process.env[k] ?? '']));
if (needed.some((k) => !env[k])) {
  const o = stackOutputs();
  env.API_URL ||= o.ApiUrl;
  env.MCP_URL ||= o.McpUrl;
  env.USER_POOL_ID ||= o.UserPoolId;
  env.USER_POOL_CLIENT_ID ||= o.UserPoolClientId;
}
if (!env.MCP_URL) throw new Error('McpUrl is not in the stack outputs — has the stack been deployed with milestone 4?');
const apiBase = env.API_URL.replace(/\/$/, '');

const cognito = new CognitoIdentityProviderClient({ region });
const runId = randomBytes(4).toString('hex');
const password = `Aa1!${randomBytes(9).toString('base64url')}`;
const personas: Persona[] = ['owner', 'editor', 'viewer', 'outsider'];
const emails = Object.fromEntries(personas.map((p) => [p, `clara-mcp-e2e-${runId}-${p}@example.com`])) as Record<
  Persona,
  string
>;
const idTokens = {} as Record<Persona, string>;
const tokenIds = {} as Record<Persona, string>;
let workspaceId = '';

async function rest(as: Persona, method: string, path: string, body?: unknown) {
  const res = await fetch(`${apiBase}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${idTokens[as]}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined };
}

async function must(as: Persona, method: string, path: string, body?: unknown) {
  const r = await rest(as, method, path, body);
  if (r.status >= 300) throw new Error(`${method} ${path} as ${as} -> ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}

const driver: Driver = {
  async setup() {
    for (const p of personas) {
      await cognito.send(
        new SignUpCommand({
          ClientId: env.USER_POOL_CLIENT_ID,
          Username: emails[p],
          Password: password,
          UserAttributes: [{ Name: 'email', Value: emails[p] }],
        }),
      );
      await cognito.send(new AdminConfirmSignUpCommand({ UserPoolId: env.USER_POOL_ID, Username: emails[p] }));
      const auth = await cognito.send(
        new InitiateAuthCommand({
          ClientId: env.USER_POOL_CLIENT_ID,
          AuthFlow: 'USER_PASSWORD_AUTH',
          AuthParameters: { USERNAME: emails[p], PASSWORD: password },
        }),
      );
      idTokens[p] = auth.AuthenticationResult!.IdToken!;
    }
    workspaceId = (await must('owner', 'POST', '/workspaces', { name: `mcp-e2e-${runId}` })).id;
    await must('owner', 'POST', `/workspaces/${workspaceId}/members`, { email: emails.editor, role: 'editor' });
    await must('owner', 'POST', `/workspaces/${workspaceId}/members`, { email: emails.viewer, role: 'viewer' });

    const tokens = {} as Record<Persona, string>;
    for (const p of personas) {
      const t = await must(p, 'POST', '/tokens', { name: `e2e-${p}`, expiresInDays: 1 });
      tokens[p] = t.token;
      tokenIds[p] = t.id;
    }
    // A Cognito session must not be usable as an MCP credential, nor an MCP token as a REST credential.
    const asRest = await fetch(`${apiBase}/me`, { headers: { authorization: `Bearer ${tokens.owner}` } });
    if (asRest.status !== 401)
      throw new Error(`a personal access token was accepted by the REST API (${asRest.status})`);
    return { workspaceId, tokens };
  },
  async post(token, body) {
    const res = await fetch(env.MCP_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : undefined };
  },
  accept: (as, id, force) => rest(as, 'POST', `/pending-changes/${id}/accept`, { force: !!force }),
  reject: (as, id) => rest(as, 'POST', `/pending-changes/${id}/reject`),
  listPending: async (as, ws) => (await must(as, 'GET', `/workspaces/${ws}/pending-changes?status=pending`)) as any[],
  getDocument: (id) => must('owner', 'GET', `/documents/${id}`),
  getDiagram: (id) => must('owner', 'GET', `/diagrams/${id}`),
  editDocument: async (id, contentMd) => void (await must('owner', 'PATCH', `/documents/${id}`, { contentMd })),
  versionCount: async (kind, id) => ((await must('owner', 'GET', `/${kind}/${id}/versions`)) as unknown[]).length,
  async cleanup() {
    for (const p of personas) await rest(p, 'DELETE', `/tokens/${tokenIds[p]}`).catch(() => undefined);
    if (workspaceId) await rest('owner', 'DELETE', `/workspaces/${workspaceId}`).catch(() => undefined);
    for (const p of personas) {
      await cognito
        .send(new AdminDeleteUserCommand({ UserPoolId: env.USER_POOL_ID, Username: emails[p] }))
        .catch(() => undefined);
    }
  },
};

console.log(`MCP e2e against ${env.MCP_URL}`);
await runScenario(driver);
console.log('e2e scenario passed');
