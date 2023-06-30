/* global echo */
import 'zx/globals'
import { Octokit } from 'octokit'

// thanks to Siddhartha Varma for documenting the workflow steps
// https://siddharthav.medium.com/push-multiple-files-under-a-single-commit-through-github-api-f1a5b0b283ae

const defaultHeaders = {
  'X-GitHub-Api-Version': '2022-11-28',
}

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
  const octokit = new Octokit({ auth: config.token || process.env.GITHUB_TOKEN })
  const owner = config.owner
  const repo = config.repo
  const branch = config.branch
  const headers = config.headers || defaultHeaders

  // Create Blobs
  // https://docs.github.com/en/rest/git/blobs?apiVersion=2022-11-28#create-a-blob
  for (const file of files) {
    const { data } = await octokit.request('POST /repos/{owner}/{repo}/git/blobs', {
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

  // Get Tree
  // https://docs.github.com/en/rest/git/trees?apiVersion=2022-11-28#get-a-tree
  const response = await octokit.request('GET /repos/{owner}/{repo}/git/trees/{tree_sha}', {
    owner,
    repo,
    tree_sha: config.branch,
    headers,
  })
  if (debug) {
    echo`${JSON.stringify(response, null, 2)}`
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

  // Create Tree
  // https://docs.github.com/en/rest/git/trees?apiVersion=2022-11-28#create-a-tree
  const treeResponse = await octokit.request('POST /repos/{owner}/{repo}/git/trees', {
    owner,
    repo,
    base_tree: response.data.sha,
    tree,
    headers,
  })
  if (debug) {
    echo`${JSON.stringify(treeResponse, null, 2)}`
  }

  // Get Sha from main branch
  const shaResponse = await octokit.request('GET /repos/{owner}/{repo}/git/refs/heads/{branch}', {
    owner,
    repo,
    branch,
    headers,
  })
  if (debug) {
    echo`${JSON.stringify(shaResponse.data, null, 2)}`
  }

  // Add Commit
  // https://docs.github.com/en/rest/git/commits?apiVersion=2022-11-28#create-a-commit
  const commitResponse = await octokit.request('POST /repos/{owner}/{repo}/git/commits', {
    tree: treeResponse.data.sha,
    message,
    parents: [shaResponse.data.object.sha],
    owner,
    repo,
    headers,
  })
  if (debug) {
    echo`${JSON.stringify(commitResponse.data, null, 2)}`
  }

  // Update Reference
  // https://docs.github.com/en/rest/git/refs?apiVersion=2022-11-28#update-a-reference
  const updateResponse = await octokit.request('PATCH /repos/{owner}/{repo}/git/refs/heads/{branch}', {
    branch,
    sha: commitResponse.data.sha,
    owner,
    repo,
    headers,
  })
  if (debug) {
    echo`${JSON.stringify(updateResponse.data, null, 2)}`
  }

  if (tag) {
    // Update Reference
    // https://docs.github.com/en/rest/git/refs?apiVersion=2022-11-28#update-a-reference
    const updateTagResponse = await octokit.request('POST /repos/{owner}/{repo}/git/refs/tags/{tag}', {
      tag,
      sha: commitResponse.data.sha,
      owner,
      repo,
      headers,
    })
    if (debug) {
      echo`${JSON.stringify(updateTagResponse.data, null, 2)}`
    }
  }
  return updateResponse.data
}
