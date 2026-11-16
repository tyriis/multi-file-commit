<!-- markdownlint-disable MD041 -->
<!-- markdownlint-disable MD033 -->
<!-- markdownlint-disable MD028 -->

<!-- PROJECT SHIELDS -->
<!--
*** I'm using markdown "reference style" links for readability.
*** Reference links are enclosed in brackets [ ] instead of parentheses ( ).
*** See the bottom of this document for the declaration of the reference variables
*** for contributors-url, forks-url, etc. This is an optional, concise syntax you may use.
*** https://www.markdownguide.org/basic-syntax/#reference-style-links
-->

[![pre-commit][pre-commit-shield]][pre-commit-url]
[![taskfile][taskfile-shield]][taskfile-url]

# Multi File Commit

This action commits multiple files in one commit through the GitHub API. It uploads each file as a blob and adds the blobs to a tree.
The action commits all staged files, or only the staged files that match the `files` input.

<details>
  <summary style="font-size:1.2em;">Table of Contents</summary>
<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->

- [User Story](#user-story)
- [The Idea](#the-idea)
- [Limitations](#limitations)
- [What's new](#whats-new)
- [Usage](#usage)
- [Outputs](#outputs)
- [License](#license)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->
</details>

## User Story

As a user, I want to commit multiple files in one commit. A `git push` cannot sign the commit in an action context.
I also want to use the `only signed commits` restriction on my branches. I do not want to bypass the restriction, because I want to protect my software supply chain.

## The Idea

The GitHub API can create blobs, a tree, and a commit.
I found the solution to this problem here: <https://siddharthav.medium.com/push-multiple-files-under-a-single-commit-through-github-api-f1a5b0b283ae>

Thanks for your work [Siddhartha Varma](https://github.com/BRO3886).

## Limitations

> [!IMPORTANT]
>
> - This action does not work on an empty repository.
> - The action commits only files that `git status` reports as added or modified. It does not commit
>   deletions.
> - The action retries a concurrent commit to the same branch up to 5 attempts. Each attempt rebuilds the
>   commit on top of the latest head. If the branch moves on every attempt, the run fails with an error
>   and does not overwrite the change from the other run.
> - The action retries only a ref update that failed because the branch moved. A protected-branch
>   rejection, a missing branch, or any other 422 fails immediately.
> - The action cannot detect a branch that was force-pushed backwards during a retry. The new head is an
>   ancestor of the commit to push, so the API accepts the update. There is no conditional write, and the
>   run re-adds the removed commits.
> - Parallel runs that commit the same file overwrite each other. Each run uploads the whole file from its
>   own checkout. A run that started before another run finished restores the older content and still
>   reports success.
> - Run jobs that commit the same file sequentially. As an alternative, re-read the file and apply the
>   change again when the branch moved. Runs that commit different files are safe
>   ([#9](https://github.com/tyriis/multi-file-commit/issues/9)).

## What's new

- The first implementation is in testing
- The runtime is upgraded to Node 24 (GitHub Action runtime and package engine)
- `zx` is upgraded to the latest major version (8.x)
- The action retries concurrent commits to the same branch up to 5 attempts. It does not overwrite the change from the other run ([#9](https://github.com/tyriis/multi-file-commit/issues/9))
- The action skips with a notice when no staged file is selected ([#9](https://github.com/tyriis/multi-file-commit/issues/9))

## Usage

<!-- start usage -->

```yaml
- uses: tyriis/multi-file-commit@v1.2.0
  with:
    # Repository name with owner. For example, tyriis/multi-file-commit
    # Default: ${{ github.repository }}
    repository: ''

    # The branch to push the commit to. The branch must already exist.
    # Default: ${{ github.ref_name }}
    ref: ''

    # Personal access token (PAT) or GitHub App token used to authenticate the API calls.
    # Default: ${{ github.token }}
    token: ''

    # The commit message for the commit.
    # Required.
    message: ''

    # A list of files to commit, prevents other staged files from being committed.
    # Example: src/main.mjs,src/main.spec.js
    # If not set, all staged files are considered for commit.
    # If no staged file matches, the action skips, makes no commit, and leaves the `sha` output empty.
    files: ''

    # In case you want to tag your commit, pass a tag reference and this action does the work for you.
    tag: ''
```

<!-- end usage -->

## Outputs

- `sha`: The SHA of the new commit. The action sets this output after a successful commit. When no staged file matches the `files` input, the action skips and leaves the output empty.

## License

The scripts and documentation in this project are released under the [MIT License](LICENSE)

<!-- Badges -->

[pre-commit-shield]: https://img.shields.io/badge/pre--commit-enabled-brightgreen?logo=pre-commit&style=for-the-badge
[pre-commit-url]: https://github.com/pre-commit/pre-commit
[taskfile-url]: https://taskfile.dev/
[taskfile-shield]: https://img.shields.io/badge/Taskfile-Enabled-brightgreen?logoColor=white&style=for-the-badge
