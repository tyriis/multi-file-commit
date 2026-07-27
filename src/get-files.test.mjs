import { describe, it, afterAll, expect } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execSync } from 'node:child_process'

describe('readFile trailing newline preservation', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'mfc-test-'))

  afterAll(() => rmSync(tmp, { recursive: true, force: true }))

  const scenarios = [
    { name: 'with trailing newline', content: 'line1\nline2\n', expected: 'line1\nline2\n' },
    { name: 'with trailing newlines', content: 'line1\nline2\n\n\n', expected: 'line1\nline2\n\n\n' },
    { name: 'without trailing newline', content: 'line1\nline2', expected: 'line1\nline2' },
    { name: 'single line no newline', content: 'hello', expected: 'hello' },
    { name: 'empty file', content: '', expected: '' },
  ]

  for (const { name, content, expected } of scenarios) {
    it(`preserves bytes: ${name}`, async () => {
      const filePath = join(tmp, name.replace(/\s+/g, '-'))
      writeFileSync(filePath, content, 'utf-8')
      const raw = await readFile(filePath)
      expect(raw.toString('utf-8')).toBe(expected)
      expect(raw.toString('utf-8').length).toBe(content.length)
    })
  }
})

describe('getFiles integration', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'mfc-repo-'))

  afterAll(() => rmSync(tmp, { recursive: true, force: true }))

  it('preserves trailing newlines in staged files', async () => {
    const cwd = process.cwd()
    try {
      process.chdir(tmp)

      execSync('git init', { cwd: tmp })
      execSync('git config user.name test', { cwd: tmp })
      execSync('git config user.email test@test.com', { cwd: tmp })

      const files = {
        'with-newline.txt': 'hello\nworld\n',
        'no-newline.txt': 'hello\nworld',
        'multi-newline.txt': 'hello\nworld\n\n\n',
      }

      for (const [name, content] of Object.entries(files)) {
        writeFileSync(join(tmp, name), content, 'utf-8')
      }

      execSync('git add .', { cwd: tmp })

      const { getFiles } = await import('./get-files.mjs')
      const result = await getFiles()

      for (const item of result) {
        expect(item.content).toBe(files[item.path])
      }
    } finally {
      process.chdir(cwd)
    }
  })
})
