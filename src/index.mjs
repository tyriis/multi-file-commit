import * as core from '@actions/core'
import * as github from '@actions/github'
import { commit } from './commit.mjs'
import { getFiles } from './get-files.mjs'

try {
  const filesInput = core.getInput('files')
  const context = github.context
  const repo = (core.getInput('repository') || context.github.repository).split('/')
  const token = core.getInput('token')
  const message = core.getInput('message')
  const branch = core.getInput('ref') || context.github.ref_name
  const files = await getFiles(filesInput)
  const result = commit(
    {
      token,
      branch,
      owner: repo[0],
      repo: repo[1],
    },
    files,
    message
  )
  console.log(JSON.stringify({ result, context }, undefined, 2))
} catch (error) {
  core.setFailed(error.message)
}
