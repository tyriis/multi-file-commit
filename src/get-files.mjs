/* global $, echo */
import 'zx/globals'

const debug = process.env.NODE_LOG_LEVEL === 'debug'

// const filesInput = argv.files?.trim().split(',') || null

const mapEncoding = (encoding) => {
  const encodingMap = {
    // not sure if us-ascii is even suported on git/github blob
    'us-ascii': 'utf-8',
  }
  return encoding in encodingMap ? encodingMap[encoding] : encoding
}

// Retrieve all file objects changed and staged.
export const getFiles = async (filesInput) => {
  if (debug) {
    echo`${JSON.stringify({ filesInput }, null, 2)}`
  }

  // alternate strategy to use git diff
  // const diff = await $`git diff --name-only`

  // track added files only
  const diff = await $`git status --short`
  const rows = `${diff}`.trim().split('\n')
  let files = []
  for (let row of rows) {
    let columns = row.split(' ').filter((item) => item !== '')
    if (['A', 'M', 'AM'].indexOf(columns[0]) >= 0) {
      files.push(columns[1])
    }
  }

  // remove files not listed in `filesInput`
  if (filesInput) {
    files = files.filter((file) => filesInput.indexOf(file) >= 0)
  }
  if (debug) {
    echo`${JSON.stringify(files, null, 2)}`
  }

  // extract required data for gh api
  const data = []
  for (const path of files) {
    const content = await $`cat ${path}`
    const encoding = await $`git show :${path} | file -b --mime-encoding -`
    const mode = await $`stat -c "%a" ${path}`
    const item = {
      path,
      content: `${content}`,
      encoding: mapEncoding(`${encoding}`.trim()),
      mode: `100${mode}`.trim(), // not sure is prefix is always 100
    }
    data.push(item)
    if (debug) {
      echo`${JSON.stringify({ item, path }, null, 2)}`
    }
  }
  if (debug) {
    echo`${JSON.stringify({ data }, null, 2)}`
  }
  return data
}
