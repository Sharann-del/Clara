// Milestone "complete product": favorites, public read-only share links, onboarding records, and cleanup of the
// polymorphic rows (permissions / favorites / share links) when a document or diagram is deleted.
//
// share_links.token is a 192-bit random value; it is the whole credential for a public link,
// so it's unique and looked up directly. Revoking sets revoked_at (kept for audit).
export const sql = `
create table favorites (
  user_id text not null,
  resource_type text not null check (resource_type in ('document', 'diagram')),
  resource_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, resource_type, resource_id)
);

create table share_links (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  resource_type text not null check (resource_type in ('document', 'diagram')),
  resource_id uuid not null,
  created_by text not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index share_links_resource_idx on share_links(resource_type, resource_id);

-- Accounts that already got first-run setup (POST /onboarding), so it happens once per account
-- ever, even if they later delete every workspace.
create table onboarded_users (
  user_id text primary key,
  onboarded_at timestamptz not null default now()
);

create or replace function cleanup_resource_refs() returns trigger as $$
begin
  delete from permissions where resource_id = old.id and resource_type = tg_argv[0];
  delete from favorites where resource_id = old.id and resource_type = tg_argv[0];
  update share_links set revoked_at = coalesce(revoked_at, now()) where resource_id = old.id and resource_type = tg_argv[0];
  return old;
end;
$$ language plpgsql;

create trigger documents_cleanup_refs after delete on documents
  for each row execute function cleanup_resource_refs('document');
create trigger diagrams_cleanup_refs after delete on diagrams
  for each row execute function cleanup_resource_refs('diagram');
`;
