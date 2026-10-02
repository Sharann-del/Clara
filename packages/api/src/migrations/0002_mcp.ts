// Milestone 4: personal access tokens (MCP auth) and the pending_mcp_changes review queue (PRD 4.11).
//
// Tokens are stored only as a sha256 hash — the plaintext is shown once at creation.
// pending_mcp_changes.diff_payload holds the *proposed* values plus a `base` snapshot
// of the fields as they were when proposed; accept compares that base against the
// live row so a stale proposal can't silently clobber newer human edits.
export const sql = `
create table personal_access_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  name text not null,
  token_prefix text not null,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index personal_access_tokens_user_id_idx on personal_access_tokens(user_id);

create table pending_mcp_changes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  resource_type text not null check (resource_type in ('document', 'diagram')),
  -- null for 'create' until accepted; on accept it points at the created resource.
  resource_id uuid,
  operation text not null check (operation in ('create', 'update')),
  diff_payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  proposed_by text not null,
  token_id uuid references personal_access_tokens(id) on delete set null,
  summary text not null default '',
  created_at timestamptz not null default now(),
  reviewed_by text,
  reviewed_at timestamptz
);
create index pending_mcp_changes_workspace_status_idx on pending_mcp_changes(workspace_id, status, created_at desc);
create index pending_mcp_changes_resource_idx on pending_mcp_changes(resource_type, resource_id);
`;
