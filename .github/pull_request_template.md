## What this changes

<!-- A short description of the change and why it's needed. Link the issue it closes, e.g. "Closes #12". -->

## How it was tested

<!-- Commands you ran and what you checked by hand. For UI changes, describe the flow you tried. -->

## Checklist

- [ ] `npm run lint`, `npm run format:check`, `npm run typecheck` and `npm test` pass locally
- [ ] Tests are added or updated for behaviour changes
- [ ] Docs in `docs/` or the package README are updated if behaviour, configuration or deployment changed
- [ ] `CHANGELOG.md` has a line under `## [Unreleased]`
- [ ] Database changes are a new migration in `packages/api/src/migrations/`, not an edit to an existing one
- [ ] Infrastructure changes state their effect on the monthly AWS bill
- [ ] No secrets, account IDs, tokens or personal data are included
