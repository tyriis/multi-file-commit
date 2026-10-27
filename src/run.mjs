import * as core from '@actions/core'
import * as github from '@actions/github'
import { commit } from './commit.mjs'
import { getFiles } from './get-files.mjs'
import 'zx/globals'

/* global $, echo */
$.verbose = false

// Dependencies are injectable so the entry point can be tested without network, git or @actions/core.
export const run = async (deps = {}) => {
  const coreModule = deps.core || core
  const context = deps.context || github.context
  const getFilesFn = deps.getFiles || getFiles
  const commitFn = deps.commit || commit

  const filesInput = coreModule.getInput('files')
  const repo = (coreModule.getInput('repository') || `${context.repo.owner}/${context.repo.repo}`).split('/')
  const token = coreModule.getInput('token')
  const message = coreModule.getInput('message')
  const branch = coreModule.getInput('ref') || context.ref.replace(/^refs\/heads\//, '')
  const tag = coreModule.getInput('tag') || false

  const files = await getFilesFn(filesInput)
  if (files.length === 0) {
    // A true no-op: no API call, no sha output, and reaching the notice is success.
    coreModule.notice('no files to commit, skipping')
    return undefined
  }

  // Retrying a lost ref race lives in commit(); there is no second retry loop here.
  const result = await commitFn({ token, branch, owner: repo[0], repo: repo[1] }, files, message, tag)
  echo`${JSON.stringify({ result, branch, repo, message, tag }, undefined, 2)}`
  coreModule.setOutput('sha', result.object?.sha)
  return result
}
