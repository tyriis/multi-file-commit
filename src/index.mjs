import * as core from '@actions/core'
import * as github from '@actions/github'
import { commit } from './commit.mjs'
import { getFiles } from './get-files.mjs'
import 'zx/globals'

/* global $ */
$.verbose = false
const retryLimit = 10

const getResult = async (context, token, branch, repo, files, message, tag, count) => {
  if (!count) count = 0
  try {
    const result = await commit(
      {
        token,
        branch,
        owner: repo[0],
        repo: repo[1],
      },
      files,
      message,
      tag
    )
    echo`${JSON.stringify({ result, context, branch, repo, message, tag }, undefined, 2)}`
    return result
  } catch (error) {
    if (error.message === 'Update is not a fast forward' && count <= retryLimit ) {
      count++
      return await getResult(context, token, branch, repo, files, message, tag, count)
    } else if (error.message === 'Update is not a fast forward') {
      throw new Error('Update is not a fast forward, retry limit reached.')
    } else {
      throw error
    }
  }
}

try {
  const filesInput = core.getInput('files')
  const context = github.context
  const repo = (core.getInput('repository') || context.github.repository).split('/')
  const token = core.getInput('token')
  const message = core.getInput('message')
  const branch = core.getInput('ref') || context.github.ref_name
  const tag = core.getInput('tag') || false
  const files = await getFiles(filesInput)
  const result = await getResult(context, token, branch, repo, files, message, tag)
  core.setOutput('sha', result.object?.sha)
} catch (error) {
  core.setFailed(error.message)
}
