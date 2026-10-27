/* global echo */
import 'zx/globals'
import { Octokit } from 'octokit'

// thanks to Siddhartha Varma for documenting the workflow steps
// https://siddharthav.medium.com/push-multiple-files-under-a-single-commit-through-github-api-f1a5b0b283ae

// Retry tuning for the ref update, consumed by the retry loop.
const MAX_ATTEMPTS = 5
const BASE_DELAY_MS = 250

// A 422 on the ref update is overloaded: only these two messages mean "someone else moved the branch".
// Everything else (protected branch, required checks, missing signature, branch gone) must fail on the first attempt.
const RETRYABLE_REF_MESSAGES = ['Update is not a fast forward', 'Reference cannot be updated']

// Never compare error.message: octokit v5 appends " - <documentation_url>", so an exact match can never succeed.
const isRetryableRefUpdate = (error) =>
  error.status === 422 && RETRYABLE_REF_MESSAGES.includes(error.response?.data?.message)

class RefConflictError extends Error {
  constructor(cause) {
    super(cause.message)
    this.name = 'RefConflictError'
    this.cause = cause
  }
}

const defaultHeaders = {
  'X-GitHub-Api-Version': '2022-11-28',
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const debug = process.env.NODE_LOG_LEVEL === 'debug'

// APP AUTH is working
// import { createTokenAuth } from "@octokit/auth-token"
// import { App } from "octokit"
// const app = new App({
//   appId: 12345,
//   privateKey: "-----BEGIN RSA PRIVATE KEY-----\…\n-----END RSA PRIVATE KEY-----\n"
// })
// const octokit = await app.getInstallationOctokit(1234567)

// const octokit = new Octokit({ auth: GITHUB_TOKEN })

// TOKEN AUTH tested with APP TOKEN and PAT
export const commit = async (config, files, message, tag) => {
  const client = config.client || new Octokit({ auth: config.token || process.env.GITHUB_TOKEN })
  const sleep = config.sleep || defaultSleep
  const owner = config.owner
  const repo = config.repo
  const branch = config.branch
  const headers = config.headers || defaultHeaders

  // Create Blobs
  // https://docs.github.com/en/rest/git/blobs?apiVersion=2022-11-28#create-a-blob
  // Blobs are uploaded exactly once, before the retry loop: a retry only needs the new head, not new blobs.
  for (const file of files) {
    const { data } = await client.request('POST /repos/{owner}/{repo}/git/blobs', {
      owner,
      repo,
      content: file.content,
      encoding: file.encoding,
      headers: config.headers || headers,
    })
    file.sha = data.sha
    file.url = data.url
    if (debug) {
      echo`${JSON.stringify(data, null, 2)}`
    }
  }
  if (debug) {
    echo`${JSON.stringify(files, null, 2)}`
  }

  const tree = []

  for (const file of files) {
    tree.push({
      path: file.path,
      mode: file.mode,
      type: 'blob',
      sha: file.sha,
    })
  }
  if (debug) {
    echo`${JSON.stringify(tree, null, 2)}`
  }

  // Only the PATCH is wrapped: it is the one call that can lose a race, so it is the only source of a ref conflict.
  // https://docs.github.com/en/rest/git/refs?apiVersion=2022-11-28#update-a-reference
  const updateRef = async (sha) => {
    try {
      return await client.request('PATCH /repos/{owner}/{repo}/git/refs/heads/{branch}', {
        branch,
        sha,
        owner,
        repo,
        headers,
      })
    } catch (error) {
      if (isRetryableRefUpdate(error)) {
        throw new RefConflictError(error)
      }
      throw error
    }
  }

  let updateResponse
  let commitSha

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (debug) {
      echo`ref update attempt ${attempt} of ${MAX_ATTEMPTS}`
    }
    try {
      // Re-read the ref on every attempt: a concurrent commit moved the branch, so the base tree and the parent
      // must come from the new head. Blobs are already uploaded and are reused as they are.
      // https://docs.github.com/en/rest/git/refs?apiVersion=2022-11-28#get-a-reference
      const refResponse = await client.request('GET /repos/{owner}/{repo}/git/refs/heads/{branch}', {
        owner,
        repo,
        branch,
        headers,
      })
      if (debug) {
        echo`${JSON.stringify(refResponse.data, null, 2)}`
      }
      const headSha = refResponse.data.object.sha

      // Get the tree of that commit
      // https://docs.github.com/en/rest/git/commits?apiVersion=2022-11-28#get-a-commit
      const headCommitResponse = await client.request('GET /repos/{owner}/{repo}/git/commits/{commit_sha}', {
        owner,
        repo,
        commit_sha: headSha,
        headers,
      })
      if (debug) {
        echo`${JSON.stringify(headCommitResponse.data, null, 2)}`
      }

      // Create Tree
      // https://docs.github.com/en/rest/git/trees?apiVersion=2022-11-28#create-a-tree
      const treeResponse = await client.request('POST /repos/{owner}/{repo}/git/trees', {
        owner,
        repo,
        base_tree: headCommitResponse.data.tree.sha,
        tree,
        headers,
      })
      if (debug) {
        echo`${JSON.stringify(treeResponse, null, 2)}`
      }

      // Add Commit
      // https://docs.github.com/en/rest/git/commits?apiVersion=2022-11-28#create-a-commit
      const commitResponse = await client.request('POST /repos/{owner}/{repo}/git/commits', {
        tree: treeResponse.data.sha,
        message,
        parents: [headSha],
        owner,
        repo,
        headers,
      })
      if (debug) {
        echo`${JSON.stringify(commitResponse.data, null, 2)}`
      }

      updateResponse = await updateRef(commitResponse.data.sha)
      commitSha = commitResponse.data.sha
      break
    } catch (error) {
      if (!(error instanceof RefConflictError)) {
        throw error
      }
      if (attempt === MAX_ATTEMPTS) {
        throw new Error(
          `Failed to update branch ${branch} after ${MAX_ATTEMPTS} attempts: ${error.cause.response.data.message}`
        )
      }
      await sleep(BASE_DELAY_MS * attempt + Math.floor(Math.random() * BASE_DELAY_MS))
    }
  }

  if (debug) {
    echo`${JSON.stringify(updateResponse.data, null, 2)}`
  }

  // The tag is created once and outside the retry loop: a 422 here must not re-create the commit.
  if (tag) {
    // Update Reference
    // https://docs.github.com/en/rest/git/refs?apiVersion=2022-11-28#update-a-reference
    const updateTagResponse = await client.request('POST /repos/{owner}/{repo}/git/refs', {
      sha: commitSha,
      owner,
      repo,
      ref: `refs/tags/${tag}`,
      headers,
    })
    if (debug) {
      echo`${JSON.stringify(updateTagResponse.data, null, 2)}`
    }
  }
  return updateResponse.data
}
