import * as core from '@actions/core'
import * as github from '@actions/github'
import { commit } from './commit.mjs'
import { getFiles } from './get-files.mjs'
import 'zx/globals'

/* global $ */
$.verbose = false

try {
  const filesInput = core.getInput('files')
  const context = github.context
  const repo = (core.getInput('repository') || context.github.repository).split('/')
  const token = core.getInput('token')
  const message = core.getInput('message')
  const branch = core.getInput('ref') || context.github.ref_name
  const tag = core.getInput('tag') || false
  const files = await getFiles(filesInput)
  const result = await commit(
    {
      token,
      branch,
      owner: repo[0],
      repo: repo[1],
      tag,
    },
    files,
    message
  )
  console.log(JSON.stringify({ result, context, branch, repo, message }, undefined, 2))
  core.setOutput('sha', result.object?.sha)
} catch (error) {
  core.setFailed(error.message)
}
