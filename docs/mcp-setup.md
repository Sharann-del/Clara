# MCP setup

Clara runs a [Model Context Protocol](https://modelcontextprotocol.io) server, so Claude and other
AI assistants can read your documents and diagrams and propose changes. **Proposals never apply
on their own.** Each one waits under *Pending changes* until a person accepts or rejects it.

## How it works

- **Endpoint:** the `McpUrl` stack output, which is your `ApiUrl` followed by `/mcp`.
- **Transport:** streamable HTTP, stateless. Every `POST` gets one JSON response; `GET` and `DELETE`
  return 405 because there are no sessions to stream or end.
- **Auth:** a Clara personal access token in the `Authorization` header. Cognito tokens are not
  accepted here, and personal access tokens are not accepted by the REST API.
- **Permissions:** a token acts as the person who created it, with their **current** roles. It can
  read whatever they can read and propose changes only where they're an editor. Demote the person
  and their tokens lose access too.

## 1. Create a token

Sign in to Clara, open **Settings → Access tokens** (`/settings/tokens`), name the token (for
example "Claude Code on my laptop") and choose an expiry: 1–365 days or never, 90 by default.
Copy the token straight away. Clara stores only a SHA-256 hash and can't show it again.

Tokens look like `clara_pat_` followed by 43 random characters. Each person can have 20 active
tokens; revoke unused ones on the same page.

## 2. Connect Claude Code

```bash
claude mcp add --transport http clara https://a1b2c3d4e5.execute-api.eu-north-1.amazonaws.com/mcp \
  --header "Authorization: Bearer $CLARA_TOKEN"
claude mcp list        # clara should show as connected
```

Use your own `McpUrl`, and keep the token in an environment variable (`CLARA_TOKEN` above) rather
than typing it into your shell history. The in-app docs at `/docs/mcp` show the command with your
deployment's URL already filled in.

## 3. Connect other clients

Any MCP client that speaks streamable HTTP and can send a custom header works the same way. Clients
that only launch local (stdio) servers, such as Claude Desktop, can reach Clara through the
[`mcp-remote`](https://www.npmjs.com/package/mcp-remote) bridge. In `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "clara": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://a1b2c3d4e5.execute-api.eu-north-1.amazonaws.com/mcp",
        "--header",
        "Authorization:${CLARA_AUTH}"
      ],
      "env": { "CLARA_AUTH": "Bearer clara_pat_ExampleTokenValue0123456789abcdefghijklmnop" }
    }
  }
}
```

claude.ai's custom connectors expect OAuth, which Clara doesn't implement yet (see the
[roadmap](roadmap.md)).

## 4. Ask for something

```
> List my Clara workspaces
> Read the "Checkout" diagram and add a CDN in front of the storefront
> Import this Mermaid as a new diagram called "Payments" in the Platform workspace
> Tighten the wording in the "Incident runbook" document
```

The assistant gets a reply like "Nothing has been changed yet: the proposal is saved for a human to
review…", and can call `list_my_proposals` later to see what happened to it.

## 5. Review

Open the workspace in Clara and choose **Pending changes** (the badge counts what's waiting).
Workspace editors and above can review.

- Documents show a line diff. Diagrams show added, changed and removed shapes, with before and
  after values for each changed property.
- **Accept** applies the change as you, through the same code path as a manual edit, and saves the
  previous version to history so it can be restored.
- **Reject** discards it.
- If the item changed after the proposal was made, Clara warns you and shows the diff against the
  current version before you can force it through.

## Tools

| Tool | Kind | What it does |
| --- | --- | --- |
| `list_workspaces` | read | Workspaces you belong to, with your role |
| `list_documents` | read | Documents in a workspace (id, title, tags, folder), optionally one folder |
| `read_document` | read | Full markdown and metadata |
| `create_document` | proposal | A new document: `workspace_id`, `title`, `content_md`, `tags`, `folder_id`, `summary` |
| `update_document` | proposal | Replace the body (`content_md`) or apply `text_edits` (find/replace, each `find` must match once); also `title`, `tags` |
| `list_diagrams` | read | Diagrams in a workspace (id, name, tags, parent) |
| `read_diagram` | read | Elements, source code and child diagrams |
| `create_diagram` | proposal | A new diagram, optionally with elements and as a child of another diagram |
| `update_diagram` | proposal | Rename, retag or re-parent; `add_elements`, `update_elements` (merge-patch by id), `remove_element_ids` |
| `import_mermaid` | proposal | A diagram built from Mermaid flowchart source, as a new diagram or a full replacement |
| `traverse_diagram_hierarchy` | read | The C4 drill-down tree up and/or down from a diagram, up to 10 levels |
| `list_my_proposals` | read | Your recent proposals in a workspace and their status |

Every proposal tool takes an optional `summary`: one sentence shown to the reviewer.

## Limits

- 50 open proposals per person per workspace. Further proposals are refused until someone reviews.
- Proposed document bodies are capped at 500,000 characters, and diagrams at 1,000 elements.
- Each call must finish within 25 seconds (API Gateway's integration limit is 30).
- The HTTP API throttle (`apiThrottleRate`) covers `/mcp` too.

## Testing the endpoint by hand

```bash
MCP=https://a1b2c3d4e5.execute-api.eu-north-1.amazonaws.com/mcp
curl -s "$MCP" \
  -H "Authorization: Bearer $CLARA_TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

A `401` with `WWW-Authenticate: Bearer realm="clara-mcp"` means the token is missing, wrong, expired
or revoked. [troubleshooting.md](troubleshooting.md#mcp) covers the other errors.

## Running the server yourself

The MCP server isn't a standalone process. It's a Lambda handler (`packages/mcp-server/src/handler.ts`)
that imports `@clara/api`'s service layer, and the CDK stack deploys it on the same HTTP API. To
exercise it locally without AWS, run the scripted scenario against a scratch database:

```bash
createdb clara_scratch
DATABASE_URL=postgres://localhost/clara_scratch npx tsx packages/mcp-server/scripts/local.ts
```

It proposes, reviews, accepts and rejects changes end to end. See [testing.md](testing.md).
