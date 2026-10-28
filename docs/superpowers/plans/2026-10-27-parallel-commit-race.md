# Parallel Commit Race Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `multi-file-commit` safe when two runs commit to the same branch at the same time, and make it a no-op when there is nothing to commit.

**Architecture:** `commit()` currently reads the base tree by branch name and the parent by ref in two separate calls, so a concurrent push corrupts the result. It will instead take one atomic snapshot (the branch ref), derive the base tree from that exact commit, build the commit on that same SHA, and retry the tree→commit→ref-update sequence only when the ref update is rejected in a way that means "the branch moved" (422 plus a narrow message allowlist — `error.message` is not usable, octokit appends the documentation URL to it). Blob upload stays outside the retry loop. The entry point stops keeping its own (already dead) retry loop, skips when no files were staged, and becomes testable by moving its body into `src/run.mjs`.

**Tech Stack:** Node 24 ESM (`.mjs`), `octokit` v5, `@actions/core`, `vitest`, `@vercel/ncc` (committed `dist/`).

**Spec:** GitHub issue <https://github.com/tyriis/multi-file-commit/issues/9> (no local design doc; the requirements are quoted verbatim in Global Constraints).

## Global Constraints

- Issue proposal, verbatim: "Read the ref first. Use the tree of that commit as `base_tree` and the same SHA as parent." and "When the ref update fails with 422, read the ref again, create the tree and the commit again on top of the new head, and update the ref again. Use a maximum of 5 attempts with a short random back-off." and "also check: skip when files is empty".
- Retry predicate: `error.status === 422` **and** `error.response.data.message` in `['Update is not a fast forward', 'Reference cannot be updated']`. Do **not** compare `error.message`: octokit v5 builds it as `<message> - <documentation_url>` (plus `: <errors>` when present), so `error.message === 'Update is not a fast forward'` can never be true. That is why the retry in `src/index.mjs:28` is dead code today.
- 422 is overloaded on this endpoint (protected branch, required status checks, missing signature, `Reference does not exist`). Anything outside the allowlist must fail on the first attempt with the original error.
- Blobs are uploaded exactly once per run, before the retry loop.
- Maximum attempts: `5`. Back-off: `250 * attempt + random(0..250)` ms (attempt = 1..4).
- Empty file list: no API call, `core.notice('no files to commit, skipping')`, exit 0, `sha` output left unset. (User decision, issue #9.)
- Skipping no-op commits when the tree is unchanged is **out of scope** (user decision). Do not add it.
- No new dependencies. No change to `action.yml` inputs/outputs. No version bump (`package.json` version stays `1.1.0`; releases are separate PRs).
- Keep the existing GitHub routes (`GET/PATCH /repos/{owner}/{repo}/git/refs/heads/{branch}`). They are the pre-2021 form and are not in today's OpenAPI description, but they route and are what runs in production; migrating to `GET /git/ref/{ref}` is a separate change.
- Style: eslint `standard` + prettier (no semicolons, single quotes, 2-space indent, print width 120, `comma-dangle: always-multiline`).
- Tests: vitest, colocated `src/*.test.mjs`, no network and no real token. `commit()` accepts an injected `client` and `sleep`; `run()` accepts injected deps.
- `dist/` is tracked and is what the action actually runs: it must be rebuilt with `pnpm build` in the last task.
- Prerequisite: `node_modules` is absent — run `pnpm install --frozen-lockfile` before the first test run.

## Review Focus

- Two runs commit different files to the same branch while the head moves between attempts → the retried tree is rebuilt from the **new** head, not the head read first, and both files survive.
- A 422 that is not "the branch moved" (protected branch, required status checks, `Reference does not exist`) → exactly one attempt, original API message preserved, no duplicate commit.
- Tag creation rejected with 422 (`Reference already exists`) → not a ref conflict, no retried commit.
- Branch moving forward on every attempt (two writers racing) → 5 attempts then a clear failure naming the branch and attempt count, never a silent overwrite. Corrected after final review: a branch force-pushed *backwards* is NOT detected — the new head is an ancestor of the commit we built, so GitHub accepts the PATCH on the first attempt and the run resurrects the discarded line. No conditional-write parameter exists on this endpoint, so the code cannot detect it; the README states the limitation instead.
- Empty input: `files` unset with nothing staged, or a `files:` list matching no staged file → skip without any API call, exit 0, empty `sha`.

---

## File Structure

- `src/commit.mjs` — Git data API sequence; owns the snapshot read and the retry loop. Gains `RefConflictError`, `isRetryableRefUpdate`, `MAX_ATTEMPTS`, `BASE_DELAY_MS`, injectable `client`/`sleep`.
- `src/commit.test.mjs` — new: fake Octokit route table, request ordering, retry, allowlist, exhaustion, tag-once.
- `src/run.mjs` — new: reads action inputs, calls `getFiles`, skips when empty, calls `commit`, sets `sha`. Takes injected deps.
- `src/run.test.mjs` — new: skip, happy path, error propagation.
- `src/index.mjs` — becomes a 9-line shell: `await run()` inside `try/catch` → `core.setFailed`.
- `README.md` — Limitations + What's new + `files` input note.
- `dist/` — rebuilt.

---

### Task 1: Snapshot the branch ref before building the tree

**Files:**
- Modify: `src/commit.mjs` (blob loop at lines 33-51 stays; tree/ref section at lines 53-128 is rewritten)
- Test: `src/commit.test.mjs` (new)

**Interfaces:**
- Consumes: nothing.
- Produces: `commit(config, files, message, tag)` keeps its positional signature; `config` is `{ token, owner, repo, branch, headers?, client?, sleep? }` and returns the `PATCH .../git/refs/heads/{branch}` response `data` (`{ ref, node_id, url, object: { sha, type, url } }`). Request order must be: `GET .../git/refs/heads/{branch}` → `GET .../git/commits/{commit_sha}` → `POST .../git/trees` → `POST .../git/commits` → `PATCH .../git/refs/heads/{branch}` → optional `POST .../git/refs`.

- [ ] **Step 1: Write the failing ordering test**

Create `src/commit.test.mjs`. The fake client records route + params and dispatches through a handler map; every handler is a pure function of `params` and the per-route call count.

```js
import { describe, it, expect, vi } from 'vitest'
import { commit } from './commit.mjs'

const R = {
  blobs: 'POST /repos/{owner}/{repo}/git/blobs',
  ref: 'GET /repos/{owner}/{repo}/git/refs/heads/{branch}',
  commitRead: 'GET /repos/{owner}/{repo}/git/commits/{commit_sha}',
  treeCreate: 'POST /repos/{owner}/{repo}/git/trees',
  commitCreate: 'POST /repos/{owner}/{repo}/git/commits',
  refUpdate: 'PATCH /repos/{owner}/{repo}/git/refs/heads/{branch}',
  tagCreate: 'POST /repos/{owner}/{repo}/git/refs',
}

const createClient = (handlers) => {
  const calls = []
  const request = vi.fn(async (route, params) => {
    calls.push({ route, params })
    const nth = calls.filter((call) => call.route === route).length
    return handlers[route](params, nth)
  })
  return { client: { request }, calls }
}

const baseHandlers = () => ({
  [R.blobs]: (params) => ({ data: { sha: `blob-${params.content}`, url: 'blob-url' } }),
  [R.ref]: (params, nth) => ({
    data: { ref: `refs/heads/${params.branch}`, object: { sha: `head-${nth}`, type: 'commit' } },
  }),
  [R.commitRead]: (params) => ({ data: { sha: params.commit_sha, tree: { sha: `tree-of-${params.commit_sha}` } } }),
  [R.treeCreate]: (params) => ({ data: { sha: `newtree-from-${params.base_tree}` } }),
  [R.commitCreate]: (params) => ({ data: { sha: `commit-on-${params.parents[0]}` } }),
  [R.refUpdate]: (params) => ({ data: { ref: 'refs/heads/main', object: { sha: params.sha } } }),
  [R.tagCreate]: (params) => ({ data: { ref: params.ref, object: { sha: params.sha } } }),
})

const config = (client) => ({ token: 't', owner: 'o', repo: 'r', branch: 'main', client, sleep: async () => {} })
const files = [{ path: 'a.txt', mode: '100644' }]

it('reads the ref first and builds tree and commit from the same sha', async () => {
  const { client, calls } = createClient(baseHandlers())
  const result = await commit(config(client), files, 'msg')
  expect(calls.map((call) => call.route)).toEqual([
    R.blobs,
    R.ref,
    R.commitRead,
    R.treeCreate,
    R.commitCreate,
    R.refUpdate,
  ])
  expect(calls.find((call) => call.route === R.commitRead).params.commit_sha).toBe('head-1')
  expect(calls.find((call) => call.route === R.treeCreate).params.base_tree).toBe('tree-of-head-1')
  expect(calls.find((call) => call.route === R.commitCreate).params.parents).toEqual(['head-1'])
  expect(result.object.sha).toBe('commit-on-head-1')
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm test -- src/commit.test.mjs`
Expected: FAIL — the recorded order starts with `blobs, treeCreate, ref, …` because the code still reads the tree by branch name.

- [ ] **Step 3: Rewrite `commit()` to use one ref snapshot**

In `src/commit.mjs`, keep the blob loop as is (lines 33-51). Replace the tree-read/ref-read pair with: `GET .../git/refs/heads/{branch}` → `headSha = data.object.sha` → `GET .../git/commits/{commit_sha: headSha}` → `base_tree: data.tree.sha` → `parents: [headSha]`. Use the commit read (not `git/trees/{commit_sha}`): the tree endpoint documents `tree_sha` as "SHA1 value or ref (branch or tag) name of the tree" and does not contract a commit SHA. Keep the debug `echo` calls, `config.headers || defaultHeaders`, and the tag block as they are. Also add module-level `MAX_ATTEMPTS = 5`, `BASE_DELAY_MS = 250`, `const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))`, and resolve `const client = config.client || new Octokit({ auth: config.token || process.env.GITHUB_TOKEN })` plus `const sleep = config.sleep || defaultSleep` once at the top (unused until Task 2 — add them now so Task 2 only touches control flow).

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm test -- src/commit.test.mjs`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/commit.mjs src/commit.test.mjs
git commit -m "fix: read branch ref before building commit tree"
```

---

### Task 2: Retry tree, commit and ref update on a ref conflict

**Files:**
- Modify: `src/commit.mjs`
- Test: `src/commit.test.mjs`

**Interfaces:**
- Consumes: Task 1's request order and `client`/`sleep`/`MAX_ATTEMPTS`/`BASE_DELAY_MS` constants.
- Produces: `commit()` behaviour — up to 5 attempts of `ref → commitRead → treeCreate → commitCreate → refUpdate`; blobs once; tag created once after the first successful ref update; on the 5th retryable conflict throws `Error` with message `Failed to update branch ${branch} after 5 attempts: ${lastApiMessage}`. `RefConflictError` (extends `Error`, carries `cause`) is internal and is thrown only by the `PATCH .../git/refs/heads/{branch}` call.

- [ ] **Step 1: Write the failing retry tests**

Append to `src/commit.test.mjs`:

```js
// octokit v5 builds error.message as "<api message> - <documentation_url>".
const apiError = (status, message) =>
  Object.assign(new Error(`${message} - https://docs.github.com/rest/git/refs`), {
    status,
    response: { status, data: { message, documentation_url: 'https://docs.github.com/rest/git/refs' } },
  })
const conflict = () => apiError(422, 'Update is not a fast forward')

const failFirstRefUpdate = (message) => {
  const handlers = baseHandlers()
  const ok = handlers[R.refUpdate]
  handlers[R.refUpdate] = (params, nth) => {
    if (nth === 1) throw apiError(422, message)
    return ok(params, nth)
  }
  return handlers
}

it('retries on a fast-forward 422 and rebuilds tree and commit on the new head', async () => {
  const { client, calls } = createClient(failFirstRefUpdate('Update is not a fast forward'))
  const result = await commit(config(client), files, 'msg', 'v1')
  expect(calls.filter((call) => call.route === R.refUpdate)).toHaveLength(2)
  expect(calls.filter((call) => call.route === R.commitCreate).map((call) => call.params.parents)).toEqual([
    ['head-1'],
    ['head-2'],
  ])
  expect(calls.filter((call) => call.route === R.treeCreate).map((call) => call.params.base_tree)).toEqual([
    'tree-of-head-1',
    'tree-of-head-2',
  ])
  expect(calls.filter((call) => call.route === R.blobs)).toHaveLength(1)
  expect(calls.filter((call) => call.route === R.tagCreate)).toHaveLength(1)
  expect(result.object.sha).toBe('commit-on-head-2')
})

it('retries a concurrent-update 422', async () => {
  const { client, calls } = createClient(failFirstRefUpdate('Reference cannot be updated'))
  await commit(config(client), files, 'msg')
  expect(calls.filter((call) => call.route === R.refUpdate)).toHaveLength(2)
})

it('throws after 5 conflicting attempts', async () => {
  const handlers = baseHandlers()
  handlers[R.refUpdate] = () => {
    throw conflict()
  }
  const { client, calls } = createClient(handlers)
  const error = await commit(config(client), files, 'msg').catch((thrown) => thrown)
  expect(error.message).toContain('Failed to update branch main after 5 attempts')
  expect(error.message).toContain('Update is not a fast forward')
  expect(calls.filter((call) => call.route === R.refUpdate)).toHaveLength(5)
})

it('does not retry a protected-branch 422', async () => {
  const handlers = baseHandlers()
  handlers[R.refUpdate] = () => {
    throw apiError(422, 'Required status check "ci" is expected')
  }
  const { client, calls } = createClient(handlers)
  await expect(commit(config(client), files, 'msg')).rejects.toThrow('Required status check "ci" is expected')
  expect(calls.filter((call) => call.route === R.refUpdate)).toHaveLength(1)
  expect(calls.filter((call) => call.route === R.commitCreate)).toHaveLength(1)
})

it('does not retry a 422 when the branch is gone', async () => {
  const handlers = baseHandlers()
  handlers[R.refUpdate] = () => {
    throw apiError(422, 'Reference does not exist')
  }
  const { client, calls } = createClient(handlers)
  await expect(commit(config(client), files, 'msg')).rejects.toThrow('Reference does not exist')
  expect(calls.filter((call) => call.route === R.refUpdate)).toHaveLength(1)
})

it('does not retry a non-422 error', async () => {
  const handlers = baseHandlers()
  handlers[R.refUpdate] = () => {
    throw apiError(403, 'Resource not accessible by integration')
  }
  const { client, calls } = createClient(handlers)
  await expect(commit(config(client), files, 'msg')).rejects.toThrow('Resource not accessible by integration')
  expect(calls.filter((call) => call.route === R.refUpdate)).toHaveLength(1)
})

it('does not treat a tag conflict as a ref conflict', async () => {
  const handlers = baseHandlers()
  handlers[R.tagCreate] = () => {
    throw apiError(422, 'Reference already exists')
  }
  const { client, calls } = createClient(handlers)
  await expect(commit(config(client), files, 'msg', 'v1')).rejects.toThrow('Reference already exists')
  expect(calls.filter((call) => call.route === R.commitCreate)).toHaveLength(1)
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm test -- src/commit.test.mjs`
Expected: FAIL — no retry exists, so `refUpdate` is called once and the first assertion gets length 1.

- [ ] **Step 3: Implement the loop and the allowlist**

Add `const RETRYABLE_REF_MESSAGES = ['Update is not a fast forward', 'Reference cannot be updated']` and `const isRetryableRefUpdate = (error) => error.status === 422 && RETRYABLE_REF_MESSAGES.includes(error.response?.data?.message)`.

Structure `commit()` as: upload blobs once → `for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++)` → snapshot/tree/commit → `updateRef(...)` that wraps only the `PATCH` request and, when `isRetryableRefUpdate(error)`, throws `new RefConflictError(error)` → catch `RefConflictError`: if `attempt < MAX_ATTEMPTS`, `await sleep(BASE_DELAY_MS * attempt + Math.floor(Math.random() * BASE_DELAY_MS))` and continue; otherwise throw `new Error(\`Failed to update branch ${branch} after ${MAX_ATTEMPTS} attempts: ${error.cause.response.data.message}\`)`. Any other error is rethrown untouched. Create the tag only after `updateRef` succeeded, outside the `try` that catches conflicts, and return the `PATCH` response `data`. `echo` the attempt number when `debug`.

- [ ] **Step 4: Run the full suite**

Run: `pnpm test`
Expected: PASS — 8 tests in `commit.test.mjs` plus the existing `get-files` tests.

- [ ] **Step 5: Commit**

```bash
git add src/commit.mjs src/commit.test.mjs
git commit -m "fix: retry commit when branch ref update conflicts"
```

---

### Task 3: Entry point skips when nothing is staged and stops double-retrying

**Files:**
- Create: `src/run.mjs`
- Create: `src/run.test.mjs`
- Modify: `src/index.mjs` (replace the body with the shell)

**Interfaces:**
- Consumes: `commit(config, files, message, tag)` from Task 1/2 and `getFiles(filesInput)` (returns `Array<{ path, content, encoding, mode }>`, `[]` when nothing matches).
- Produces: `run(deps = {})` where `deps` may override `{ core, context, getFiles, commit }`; resolves to the commit result or `undefined` when skipped; throws on failure. Reads inputs `files`, `repository`, `token`, `message`, `ref`, `tag`; `context` is `github.context`.

- [ ] **Step 1: Write the failing tests**

Create `src/run.test.mjs`:

```js
import { describe, it, expect, vi } from 'vitest'
import { run } from './run.mjs'

const context = { github: { repository: 'octo/repo', ref_name: 'main' } }
const coreStub = (inputs = {}) => ({
  getInput: (name) => inputs[name] ?? '',
  notice: vi.fn(),
  setOutput: vi.fn(),
  setFailed: vi.fn(),
})

it('skips without calling the API when no files are staged', async () => {
  const core = coreStub({ message: 'msg' })
  const commitFn = vi.fn()
  const result = await run({ core, context, getFiles: async () => [], commit: commitFn })
  expect(result).toBeUndefined()
  expect(commitFn).not.toHaveBeenCalled()
  expect(core.notice).toHaveBeenCalledWith('no files to commit, skipping')
  expect(core.setOutput).not.toHaveBeenCalled()
})

it('commits staged files and sets the sha output', async () => {
  const core = coreStub({ message: 'msg', token: 'tok', repository: 'octo/repo', ref: 'dev', tag: 'v1' })
  const files = [{ path: 'a.txt', content: 'a', encoding: 'utf-8', mode: '100644' }]
  const commitFn = vi.fn().mockResolvedValue({ object: { sha: 'abc123' } })
  await run({ core, context, getFiles: async () => files, commit: commitFn })
  expect(commitFn).toHaveBeenCalledWith({ token: 'tok', branch: 'dev', owner: 'octo', repo: 'repo' }, files, 'msg', 'v1')
  expect(core.setOutput).toHaveBeenCalledWith('sha', 'abc123')
})

it('propagates commit errors instead of failing silently', async () => {
  const core = coreStub({ message: 'msg' })
  const commitFn = vi.fn().mockRejectedValue(new Error('boom'))
  await expect(run({ core, context, getFiles: async () => [{ path: 'a.txt' }], commit: commitFn })).rejects.toThrow(
    'boom',
  )
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm test -- src/run.test.mjs`
Expected: FAIL — `Cannot find module './run.mjs'`.

- [ ] **Step 3: Extract `src/run.mjs` and shrink `src/index.mjs`**

`src/run.mjs` holds everything currently in `src/index.mjs` except the `try/catch`: `$.verbose = false`, input reading (`repository` split on `/`, `branch = ref || context.github.ref_name`, `tag || false`), the empty-list skip with `core.notice('no files to commit, skipping')` returning `undefined` before any API call, the `commit(...)` call, the debug `echo` of `{ result, branch, repo, message, tag }`, and `core.setOutput('sha', result.object?.sha)`. Delete the `retryLimit`/`getResult` wrapper entirely — it is dead code (message mismatch, see Global Constraints) and retrying now lives only in `commit()`. `src/index.mjs` becomes:

```js
import * as core from '@actions/core'
import { run } from './run.mjs'

try {
  await run()
} catch (error) {
  core.setFailed(error.message)
}
```

- [ ] **Step 4: Run the full suite and the linter**

Run: `pnpm test && pnpm lint`
Expected: PASS, 17 tests total (8 commit + 3 run + 6 existing get-files), no lint errors.

- [ ] **Step 5: Commit**

```bash
git add src/run.mjs src/run.test.mjs src/index.mjs
git commit -m "feat: skip when no files are staged"
```

---

### Task 4: Document the new behaviour, rebuild `dist`

**Files:**
- Modify: `README.md` (lines 48-57 Limitations / What's new, and the `files` input description at lines 82-85)
- Modify: `dist/index.mjs` (build output, never hand-edited)

**Interfaces:**
- Consumes: Tasks 1-3. Produces: shippable action.

- [ ] **Step 1: Update the README**

Replace the limitation "parallel commits on the same file lead to a race condition where previous changes are overwritten." with a statement that concurrent commits to the same branch are retried up to 5 times on top of the latest head, and that the run fails instead of overwriting when the branch moves on every attempt. Add to "What's new": the race fix (references `#9`) and "the action skips with a notice when no staged file is selected (`#9`)". Add "If no staged file matches, the action skips and makes no commit." to the `files` input description.

- [ ] **Step 2: Rebuild `dist`**

Run: `pnpm build`
Expected: `dist/index.mjs` is rewritten and `git status` shows only `dist/` + `README.md`.

- [ ] **Step 3: Verify the bundle picked up the change**

Run: `git diff --stat dist/ && grep -c "no files to commit, skipping" dist/index.mjs`
Expected: `dist/index.mjs` changed and the grep count is at least 1.

- [ ] **Step 4: Full verification**

Run: `pnpm test && pnpm lint && pnpm build && git status --short`
Expected: tests pass, lint clean, build idempotent (no further `dist/` diff).

- [ ] **Step 5: Commit**

```bash
git add README.md dist/
git commit -m "docs: document parallel commit retries and empty skip"
```

---

## Non-goals

- Skipping commits whose tree equals the base tree (user decision: out of scope).
- Retrying blob uploads, tag creation, or anything other than the branch ref update. `Object does not exist` 422 stays out of the allowlist — no evidence it occurs for a commit we just created, and a narrow predicate is easier to reason about.
- Migrating to the documented `GET /git/ref/{ref}` / `PATCH /git/refs/{ref}` routes.
- Changing `action.yml`, inputs/outputs, or the release/version flow.
