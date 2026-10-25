import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSignup, parsePolicy } from './policy.js';

test('open mode allows everyone', () => {
  const policy = parsePolicy({});
  assert.equal(policy.mode, 'open');
  assert.deepEqual(checkSignup(policy, 'anyone@example.org', undefined), { ok: true });
});

test('allowlist matches exact emails and whole domains, case-insensitively', () => {
  const policy = parsePolicy({ SIGNUP_MODE: 'allowlist', SIGNUP_ALLOWLIST: 'Ada@Example.com, @team.example.net' });
  assert.equal(checkSignup(policy, 'ada@example.com', undefined).ok, true);
  assert.equal(checkSignup(policy, 'ADA@EXAMPLE.COM', undefined).ok, true);
  assert.equal(checkSignup(policy, 'grace@team.example.net', undefined).ok, true);
  assert.equal(checkSignup(policy, 'grace@example.com', undefined).ok, false);
  assert.equal(checkSignup(policy, 'eve@evilteam.example.net', undefined).ok, false);
  assert.equal(checkSignup(policy, undefined, undefined).ok, false);
});

test('invite mode needs one of the configured codes', () => {
  const policy = parsePolicy({ SIGNUP_MODE: 'invite', SIGNUP_INVITE_CODES: 'spring-cohort-7,design-review' });
  assert.equal(checkSignup(policy, 'a@example.com', 'design-review').ok, true);
  assert.equal(checkSignup(policy, 'a@example.com', ' spring-cohort-7 ').ok, true);
  assert.equal(checkSignup(policy, 'a@example.com', 'Design-Review').ok, false);
  const missing = checkSignup(policy, 'a@example.com', undefined);
  assert.equal(missing.ok, false);
  assert.match(missing.ok ? '' : missing.reason, /invite code is required/);
});

test('unknown modes fall back to open', () => {
  assert.equal(parsePolicy({ SIGNUP_MODE: 'closed' }).mode, 'open');
});
