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
