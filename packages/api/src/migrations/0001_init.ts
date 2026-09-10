// Clara core schema (PRD section 5). pending_mcp_changes is deferred to milestone 4.
//
// user_id columns store the Cognito `sub` (a UUID string) directly — there is
// no local `users` table; Cognito is the identity source of truth.
//
// documents/diagrams carry workspace_id directly (in addition to the nullable
// folder_id from the PRD table) so root-level items (no folder) still resolve
// to a workspace in one join, which permission checks do on every request.
export const sql = `
create table workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table workspace_members (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id text not null,
  role text not null check (role in ('owner', 'admin', 'editor', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index workspace_members_user_id_idx on workspace_members(user_id);

create table folders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  parent_folder_id uuid references folders(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index folders_workspace_id_idx on folders(workspace_id);
create index folders_parent_folder_id_idx on folders(parent_folder_id);

create table documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  folder_id uuid references folders(id) on delete set null,
  title text not null default 'Untitled',
  content_md text not null default '',
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text not null,
  updated_by text not null
);
create index documents_workspace_id_idx on documents(workspace_id);
create index documents_folder_id_idx on documents(folder_id);
create index documents_tags_idx on documents using gin(tags);

create table diagrams (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  folder_id uuid references folders(id) on delete set null,
  parent_diagram_id uuid references diagrams(id) on delete set null,
  name text not null default 'Untitled diagram',
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text not null,
  updated_by text not null
);
create index diagrams_workspace_id_idx on diagrams(workspace_id);
create index diagrams_folder_id_idx on diagrams(folder_id);
create index diagrams_parent_diagram_id_idx on diagrams(parent_diagram_id);
create index diagrams_tags_idx on diagrams using gin(tags);

create table diagram_elements (
  id uuid primary key default gen_random_uuid(),
  diagram_id uuid not null references diagrams(id) on delete cascade,
  type text not null check (type in ('rect', 'ellipse', 'text', 'connector', 'group')),
  geometry jsonb not null default '{}',
  style jsonb not null default '{}',
  z_index integer not null default 0,
  linked_diagram_id uuid references diagrams(id) on delete set null,
  parent_group_id uuid references diagram_elements(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index diagram_elements_diagram_id_idx on diagram_elements(diagram_id);

create table diagram_source (
  diagram_id uuid primary key references diagrams(id) on delete cascade,
  dsl_text text not null default '',
  format text not null default 'clara' check (format in ('clara', 'mermaid')),
  updated_at timestamptz not null default now()
);

create table diagram_states (
  id uuid primary key default gen_random_uuid(),
  diagram_id uuid not null references diagrams(id) on delete cascade,
  name text not null,
  order_index integer not null default 0,
  element_overrides jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index diagram_states_diagram_id_idx on diagram_states(diagram_id);

create table permissions (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null,
  resource_type text not null check (resource_type in ('workspace', 'folder', 'document', 'diagram')),
  user_id text not null,
  role text not null check (role in ('owner', 'editor', 'viewer')),
  created_at timestamptz not null default now(),
  unique (resource_id, resource_type, user_id)
);
create index permissions_resource_idx on permissions(resource_type, resource_id);
create index permissions_user_id_idx on permissions(user_id);

create table versions (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null,
  resource_type text not null check (resource_type in ('document', 'diagram')),
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  created_by text not null
);
create index versions_resource_idx on versions(resource_type, resource_id, created_at desc);

create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger workspaces_set_updated_at before update on workspaces
  for each row execute function set_updated_at();
create trigger folders_set_updated_at before update on folders
  for each row execute function set_updated_at();
create trigger documents_set_updated_at before update on documents
  for each row execute function set_updated_at();
create trigger diagrams_set_updated_at before update on diagrams
  for each row execute function set_updated_at();
create trigger diagram_elements_set_updated_at before update on diagram_elements
  for each row execute function set_updated_at();
`;
