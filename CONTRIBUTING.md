# Contributing to Clara

Thanks for your interest in improving Clara. This guide covers how to set up the repository, the
conventions the code follows and what a pull request needs before it can be merged.

Everyone taking part is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md). Security
problems go through [SECURITY.md](SECURITY.md), never through public issues.

## Ways to help

- **Report a bug** with the bug report template. Include steps to reproduce, what you expected
  and what happened, and your browser or device.
- **Suggest a feature** with the feature request template. Explain the problem first; a proposed
  solution is a bonus.
- **Improve the docs.** Anything in `docs/` or a package README that is wrong, unclear or out of
  date is worth a pull request.
- **Pick up an issue.** Comment on it first so two people don't do the same work.

## Development setup

You need Node.js 22, npm 10 and PostgreSQL 16. Deploying or running the full app also needs an AWS
account. Xcode 16 or later is only needed for the iOS app.

```bash
git clone https://github.com/Sharann-del/Clara.git
cd Clara
npm install
```

npm workspaces link the packages together, so one `npm install` at the root is enough.
[docs/getting-started.md](docs/getting-started.md) explains how to run the API and frontend
locally, and [docs/configuration.md](docs/configuration.md) lists every environment variable.

## Checks to run before opening a pull request

These are the same checks CI runs:

```bash
npm run lint             # ESLint across every package
npm run format:check     # Prettier
npm run typecheck        # TypeScript in shared, api, mcp-server, frontend and infra
npm test                 # unit tests in every package plus the CDK assertions
npm run build            # frontend production build
npm run infra:synth      # the CDK stack still synthesizes
```

`npm run format` rewrites files with Prettier. If you changed the UI, also run the Playwright suite
(`npm run e2e -w @clara/frontend`); see [docs/testing.md](docs/testing.md).

## Project conventions

- **One diagram renderer.** Every view and export draws through `renderDiagramSvg` in
  `@clara/shared/render`. Extend it rather than adding a second renderer.
- **Shared logic lives in `@clara/shared`.** Code that the frontend, API, MCP server and iOS app all
  need goes there, framework-free. The iOS app runs it through JavaScriptCore, so rebuild
  `ios/Clara/Resources/clara-shared.js` with `ios/scripts/build-shared-js.sh` after changing it.
- **One permission check.** REST, WebSocket and MCP all authorize through
  `packages/api/src/lib/authz.ts`. A new route that loads a document or diagram must use
  `assertResourceRole`.
- **AI writes are never applied directly.** MCP tools may only stage rows in `pending_mcp_changes`.
  Accepting a change replays it through the normal services as the reviewer.
- **Markdown stays safe.** `packages/frontend/src/lib/markdown.ts` escapes raw HTML and filters link
  and image URLs, because documents can be public. Keep it that way.
- **Database changes are migrations.** Add a new file in `packages/api/src/migrations/` and register
  it in `index.ts`. Never edit a migration that has shipped. Migrations run automatically on
  `cdk deploy`.
- **Design tokens.** Colours are tokens in `packages/frontend/src/styles.css`. The UI is dark only,
  separates layers by surface tone instead of borders, and uses amber for exactly one thing: an AI
  proposal waiting for human review. The diagram canvas has its own palette in `@clara/shared/render`.
- **Infrastructure costs money.** Changes in `packages/infra` should keep idle cost low. Say what
  a change costs in the pull request, and keep `packages/infra/test` passing.

## Commits and pull requests

- Branch from `main` and keep each pull request focused on one change.
- Write commit messages in the imperative mood with a short subject line, for example
  `api: reject share links for deleted items`. A package prefix (`api:`, `frontend:`, `infra:`,
  `shared:`, `mcp:`, `ios:`, `docs:`, `ci:`) helps reviewers.
- Add or update tests for behaviour changes. Bug fixes should come with a test that fails without
  the fix.
- Update the docs when behaviour, configuration or deployment steps change, and add a line to
  `CHANGELOG.md` under an `## [Unreleased]` heading (create it at the top if it isn't there yet).
- Fill in the pull request template. CI must be green before review.

## Releases

Maintainers tag releases from `main` as `vMAJOR.MINOR.PATCH`, following
[Semantic Versioning](https://semver.org/). Pushing a tag runs the release workflow, which builds the
frontend and the CDK assembly and attaches them to a GitHub release.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
