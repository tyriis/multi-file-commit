import { it, expect, vi } from 'vitest'
import { run } from './run.mjs'

const context = { repo: { owner: 'octo', repo: 'repo' }, ref: 'refs/heads/main' }
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
  expect(commitFn).toHaveBeenCalledWith(
    { token: 'tok', branch: 'dev', owner: 'octo', repo: 'repo' },
    files,
    'msg',
    'v1'
  )
  expect(core.setOutput).toHaveBeenCalledWith('sha', 'abc123')
})

it('falls back to the context repo and ref and defaults the tag to false', async () => {
  const core = coreStub({ message: 'msg' })
  const files = [{ path: 'a.txt', content: 'a', encoding: 'utf-8', mode: '100644' }]
  const commitFn = vi.fn().mockResolvedValue({ object: { sha: 'abc123' } })
  await run({ core, context, getFiles: async () => files, commit: commitFn })
  expect(commitFn).toHaveBeenCalledWith({ token: '', branch: 'main', owner: 'octo', repo: 'repo' }, files, 'msg', false)
})

it('propagates commit errors instead of failing silently', async () => {
  const core = coreStub({ message: 'msg' })
  const commitFn = vi.fn().mockRejectedValue(new Error('boom'))
  await expect(run({ core, context, getFiles: async () => [{ path: 'a.txt' }], commit: commitFn })).rejects.toThrow(
    'boom'
  )
})
