import { it, expect, vi } from 'vitest'
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
const makeFiles = () => [{ path: 'a.txt', mode: '100644' }]

it('reads the ref first and builds tree and commit from the same sha', async () => {
  const { client, calls } = createClient(baseHandlers())
  const result = await commit(config(client), makeFiles(), 'msg')
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
  const result = await commit(config(client), makeFiles(), 'msg', 'v1')
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
  await commit(config(client), makeFiles(), 'msg')
  expect(calls.filter((call) => call.route === R.refUpdate)).toHaveLength(2)
})

it('throws after 5 conflicting attempts', async () => {
  const handlers = baseHandlers()
  handlers[R.refUpdate] = () => {
    throw conflict()
  }
  const { client, calls } = createClient(handlers)
  const error = await commit(config(client), makeFiles(), 'msg').catch((thrown) => thrown)
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
  await expect(commit(config(client), makeFiles(), 'msg')).rejects.toThrow('Required status check "ci" is expected')
  expect(calls.filter((call) => call.route === R.refUpdate)).toHaveLength(1)
  expect(calls.filter((call) => call.route === R.commitCreate)).toHaveLength(1)
})

it('does not retry a 422 when the branch is gone', async () => {
  const handlers = baseHandlers()
  handlers[R.refUpdate] = () => {
    throw apiError(422, 'Reference does not exist')
  }
  const { client, calls } = createClient(handlers)
  await expect(commit(config(client), makeFiles(), 'msg')).rejects.toThrow('Reference does not exist')
  expect(calls.filter((call) => call.route === R.refUpdate)).toHaveLength(1)
})

it('does not retry a non-422 error', async () => {
  const handlers = baseHandlers()
  handlers[R.refUpdate] = () => {
    throw apiError(403, 'Resource not accessible by integration')
  }
  const { client, calls } = createClient(handlers)
  await expect(commit(config(client), makeFiles(), 'msg')).rejects.toThrow('Resource not accessible by integration')
  expect(calls.filter((call) => call.route === R.refUpdate)).toHaveLength(1)
})

it('does not treat a tag conflict as a ref conflict', async () => {
  const handlers = baseHandlers()
  handlers[R.tagCreate] = () => {
    throw apiError(422, 'Reference already exists')
  }
  const { client, calls } = createClient(handlers)
  await expect(commit(config(client), makeFiles(), 'msg', 'v1')).rejects.toThrow('Reference already exists')
  expect(calls.filter((call) => call.route === R.commitCreate)).toHaveLength(1)
})
