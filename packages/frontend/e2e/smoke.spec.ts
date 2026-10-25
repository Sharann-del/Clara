import { expect, test, type Page } from '@playwright/test';
import {
  AdminConfirmSignUpCommand,
  AdminDeleteUserCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

/**
 * Smoke test of the main flows.
 *
 *   E2E_BASE_URL       frontend to test (default http://localhost:5173)
 *   E2E_USER_POOL_ID   Cognito pool the frontend uses; with AWS credentials (e.g. AWS_PROFILE)
 *                      that may call AdminConfirmSignUp / AdminDeleteUser on it
 *   E2E_EMAIL_DOMAIN   domain for throwaway sign-up addresses (default example.com)
 *
 * The signed-in tests create one throwaway account through the real sign-up form, confirm it
 * with an admin call (there's no inbox to read the code from), and delete it at the end.
 * Without E2E_USER_POOL_ID they are skipped; the playground test always runs.
 */

const region = process.env.AWS_REGION ?? 'eu-north-1';
const poolId = process.env.E2E_USER_POOL_ID;
const email = `clara-smoke-${Date.now()}@${process.env.E2E_EMAIL_DOMAIN ?? 'example.com'}`;
// Fresh per run and never printed; it meets the pool's policy (10+ chars, upper, lower, digit).
const password = `Aa1-${randomBytes(12).toString('base64url')}`;

test.describe('playground (no account)', () => {
  test('renders as you type, shares a link, exports PNG', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/editor');
    const editor = page.getByLabel(/Diagram code/);
    await editor.fill('direction LR\nnode web "Smoke web"\nnode api "Smoke API"\nedge web -> api "HTTPS"');
    const preview = page.getByRole('img', { name: /Diagram with 2 shapes and 1 connections/ });
    await expect(preview).toBeVisible();
    await expect(page.locator('.viewer-content svg text', { hasText: 'Smoke API' })).toBeVisible();
    await expect(page.locator('#playground-code-status')).toHaveText('2 nodes · 1 edge');

    // A skipped line is reported, not silently dropped.
    await editor.fill('node a "A"\nnodee b');
    await expect(page.locator('#playground-code-status')).toContainText('Line 2');

    await editor.fill('node a "Shared node"');
    await page.getByRole('button', { name: /Share/ }).click();
    await expect(page.getByText(/Share link copied/)).toBeVisible();
    const link = await page.evaluate(() => navigator.clipboard.readText());
    expect(link).toMatch(/\/editor#z=/);

    const other = await context.newPage();
    await other.goto(link);
    await expect(other.getByLabel(/Diagram code/)).toHaveValue('node a "Shared node"');

    await page.getByRole('button', { name: /Export/ }).click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('menuitem', { name: /PNG/ }).click(),
    ]);
    const file = await download.path();
    expect(readFileSync(file!).subarray(0, 4).toString('latin1')).toBe('\x89PNG');
  });
});

test.describe.serial('signed-in flows', () => {
  test.skip(!poolId, 'Set E2E_USER_POOL_ID (and AWS credentials) to run sign-up based tests');
  const cognito = new CognitoIdentityProviderClient({ region });
  let page: Page;
  let workspaceUrl = '';

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
  });

  test.afterAll(async () => {
    // Best-effort cleanup: the workspace (owner) and the throwaway account.
    if (workspaceUrl) {
      try {
        await page.goto(workspaceUrl);
        await page.getByRole('button', { name: 'Workspace actions' }).click();
        await page.getByRole('menuitem', { name: 'Delete workspace' }).click();
        await page.locator('dialog[open]').getByRole('button', { name: 'Delete workspace' }).click();
        await page.waitForURL('**/app', { timeout: 10_000 });
      } catch (err) {
        console.warn(`Cleanup: couldn't delete the smoke-test workspace (${workspaceUrl}): ${(err as Error).message}`);
      }
    }
    await cognito.send(new AdminDeleteUserCommand({ UserPoolId: poolId!, Username: email })).catch(() => undefined);
    await page.close();
  });

  test('sign up, then first-run setup creates a workspace with sample content', async () => {
    await page.goto('/signup');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();

    await cognito.send(new AdminConfirmSignUpCommand({ UserPoolId: poolId!, Username: email }));
    await page.goto('/signin');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();

    // A brand-new account lands in its new workspace with the tour.
    await page.waitForURL(/\/workspaces\/[0-9a-f-]+/, { timeout: 30_000 });
    workspaceUrl = page.url().split('?')[0];
    await expect(page.getByRole('link', { name: 'Welcome to Clara' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Sample: web app architecture/ })).toBeVisible();
    const skip = page.getByRole('button', { name: 'Skip tour' });
    if (await skip.isVisible().catch(() => false)) await skip.click();
  });

  test('create a document; it saves and survives a reload', async () => {
    await page.goto(workspaceUrl);
    await page.getByRole('button', { name: /^Document$/ }).click();
    await page.waitForURL(/\/documents\//);
    await page.getByLabel('Document title').fill('Smoke test doc');
    await page.getByLabel('Document (markdown)').fill('# Hello\n\nWritten by the smoke test.');
    await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible({ timeout: 15_000 });
    await page.reload();
    await expect(page.getByLabel('Document title')).toHaveValue('Smoke test doc');
    await expect(page.getByLabel('Document (markdown)')).toHaveValue(/Written by the smoke test/);
  });

  test('create a diagram from code; it persists', async () => {
    await page.goto(workspaceUrl);
    await page.getByRole('button', { name: /^Diagram$/ }).click();
    await page.waitForURL(/\/diagrams\//);
    await page.getByRole('tab', { name: 'Code' }).click();
    await page.getByLabel(/Diagram code/).fill('node lb "Load balancer"\nnode app "App"\nedge lb -> app');
    await page.getByRole('button', { name: 'Apply to canvas' }).click();
    await expect(page.getByRole('button', { name: 'Box: Load balancer' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Box: Load balancer' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Box: App' })).toBeVisible();
  });

  test('share a document with a public link that works signed out, then revoke it', async ({ browser }) => {
    await page.goto(workspaceUrl);
    await page.getByRole('link', { name: 'Smoke test doc' }).click();
    await page.getByRole('button', { name: 'Share' }).first().click();
    await page.getByRole('button', { name: 'Create public link' }).click();
    const url = await page.locator('.share-link-row input').inputValue();
    expect(url).toMatch(/\/s\/[A-Za-z0-9_-]{20,}$/);

    const anon = await browser.newContext();
    const visitor = await anon.newPage();
    await visitor.goto(url);
    await expect(visitor.getByRole('heading', { name: 'Smoke test doc' })).toBeVisible();
    await expect(visitor.getByText('Written by the smoke test.')).toBeVisible();

    await page.getByRole('button', { name: 'Turn off' }).click();
    await page.getByRole('button', { name: 'Turn off link' }).click();
    await visitor.reload();
    await expect(visitor.getByRole('heading', { name: 'This link no longer works' })).toBeVisible();
    await anon.close();
  });
});
