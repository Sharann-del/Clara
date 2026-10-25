# Sharing and permissions

Clara has three ways to give someone access: **workspace membership**, a **direct grant** on one
document or diagram, and a **public link**. AI assistants connected over MCP never get access of
their own; they act as the person whose token they use. Every check runs in one place,
`packages/api/src/lib/authz.ts`, so REST, the WebSocket and MCP enforce identical rules.

## Workspace roles

Roles are ordered `viewer < editor < admin < owner`.

| Action | Viewer | Editor | Admin | Owner |
| --- | :-: | :-: | :-: | :-: |
| Read documents, diagrams, folders, history | ✓ | ✓ | ✓ | ✓ |
| Create, edit, move and delete documents, diagrams and folders | | ✓ | ✓ | ✓ |
| Restore a version | | ✓ | ✓ | ✓ |
| Share items, create public links | | ✓ | ✓ | ✓ |
| Review AI pending changes (accept or reject) | | ✓ | ✓ | ✓ |
| Propose changes through MCP | | ✓ | ✓ | ✓ |
| Rename the workspace | | | ✓ | ✓ |
| Invite members, change roles, remove members | | | ✓ | ✓ |
| Make someone an owner, or change an owner's role | | | | ✓ |
| Delete the workspace and everything in it | | | | ✓ |

Rules that protect a workspace:

- Whoever creates a workspace becomes its owner.
- A workspace always keeps at least one owner. The last owner can't be demoted or removed, and can't
  leave.
- Anyone can leave a workspace (`DELETE /workspaces/:id/members/:userId` with their own user ID), subject to the rule above.
- Members are invited by email. The person must already have a Clara account, because Clara looks
  them up in Cognito.

Manage members from the workspace's **Members** page (`/workspaces/:id/members`).

## Direct grants on one item

Anyone with editor access to a document or diagram can share it with another account as `viewer` or
`editor` from its **Share** page (`/documents/:id/share` or `/diagrams/:id/share`).

Your **effective role** on an item is the higher of your workspace role and your direct grant. So a
workspace viewer with an editor grant on one diagram can edit that diagram, and only that one.

A direct grant does not make someone a workspace member. With only a grant, a person can't:

- list the workspace or see other items in it
- move the item between folders, or delete it
- review pending AI changes in the workspace

Shared items appear under **Shared with you** on the home page (`GET /shared-with-me`). Grants are
removed automatically when the item is deleted. People can remove their own grant.

## Public links

An editor can create a **public, read-only link** for a document or diagram from its Share page. The
link is your site's address followed by `/s/` and the token, for example
`https://d1example2cdn3.cloudfront.net/s/q3J8c0Zr4mVn1xYb7tKpW2sLhD9eFgAu`, and needs no account.

- The token is 192 random bits and is the whole credential. Anyone with the link can view the item.
- A diagram link shows the diagram with its states, present mode and SVG/PNG/PDF export.
- A **document link** also shows the diagrams the document embeds, and only those: they must be
  embedded in the document and live in the same workspace. Nothing else in the workspace is reachable.
- Drill-down links on a shared diagram aren't followed; a child diagram needs its own link.
- Public responses are sent with `Cache-Control: no-store` and `X-Robots-Tag: noindex`, and `/s/` is
  disallowed in `robots.txt`.
- **Turning a link off** (`DELETE /share-links/:linkId`) takes effect immediately. Deleting the item
  revokes all its links.

Because documents can be public, the markdown renderer escapes raw HTML and filters link and image
URLs. Keep it that way when changing `packages/frontend/src/lib/markdown.ts`.

## AI assistants (MCP)

Personal access tokens carry **no permissions of their own**. Each MCP request resolves the token
owner's current roles, so:

- an assistant can read exactly what its owner can read;
- it can propose changes only where its owner is an editor, and viewers can't even propose;
- every proposal waits in `pending_mcp_changes` until a workspace editor reviews it;
- on accept, the change is applied **as the reviewer**, so an assistant can never do more than the
  person approving it.

Revoke a token from **Settings → Access tokens** and it stops working on the next request. See
[mcp-setup.md](mcp-setup.md).

## Where each rule is enforced

| Rule | Code |
| --- | --- |
| Workspace role lookup and checks | `workspaceRole`, `assertWorkspaceRole` in `lib/authz.ts` |
| Effective role on an item | `effectiveResourceRole`, `assertResourceRole` in `lib/authz.ts` |
| Member management and owner protection | `routes/workspaces.ts` |
| Direct grants and public links | `routes/sharing.ts` |
| Unauthenticated public reads and embed scoping | `routes/public.ts`, with `@clara/shared/embeds` |
| WebSocket access | `ws/connect-lambda.ts` (role captured at connect) and `ws/message-lambda.ts` |
| MCP access and proposals | `packages/mcp-server/src/tools.ts`, `lib/pending.ts` |

These rules are covered end to end by `packages/mcp-server/scripts/sharing-e2e.ts`: 58 checks across
REST and MCP with two real accounts (see [testing.md](testing.md)).
