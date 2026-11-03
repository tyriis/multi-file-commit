# AGENTS.md — multi-file-commit

## What this is

A GitHub Action that commits multiple files in one commit through the GitHub
API (blobs + tree), so the commit can be signed in a workflow. Single package,
ESM-only Node.js project. `action.yml` runs `dist/index.mjs`.

## Key commands

| Command               | What it does                          |
| --------------------- | ------------------------------------- |
| `pnpm test`           | Vitest unit tests (`src/*.test.mjs`)  |
| `pnpm lint`           | ESLint on `src/**/*.mjs`              |
| `pnpm build`          | `ncc build` → `dist/index.mjs`        |
| `task pre-commit:run` | Run all pre-commit hooks on all files |

Node >= 24. The exact pnpm version comes from `packageManager` in
`package.json`; `pnpm-workspace.yaml` pins `minimumReleaseAge` and denies the
`unrs-resolver` build script, so `--frozen-lockfile` installs pass a
supply-chain check.

## dist/ is committed

`dist/index.mjs` is the published artifact and is tracked in git. `Test - Suite`
fails when it is stale:

```sh
pnpm build && git status --porcelain -- dist/   # must be empty
```

That means **any change to a bundled runtime dependency** (`@actions/*`,
`octokit`, `zx`, and their transitive dependencies in `pnpm-lock.yaml`) needs a
`pnpm build` and the rebuilt `dist/index.mjs` in the same commit. Changes to
devDependencies (eslint, vitest, prettier, ncc) do not affect the bundle.

Renovate does this automatically: `postUpgradeTasks` in
`.github/renovate.json5` runs `pnpm install --frozen-lockfile` and `pnpm build`
for every branch and commits `dist/**`. Those commands need the `44-full`
Renovate image and the `allowedCommands` allowlist, both wired up in
`.github/workflows/schedule-renovate.yaml` and `.github/renovate-bot.json5`.

## Renovate

- Repo config: `.github/renovate.json5`
- Self-hosted run config (global-only options): `.github/renovate-bot.json5`
- Workflow: `.github/workflows/schedule-renovate.yaml`

Renovate cannot rebase a branch that conflicts with the base branch unless a
rebase is requested (the Rebase/Retry checkbox); it does not act on comment
commands here.
