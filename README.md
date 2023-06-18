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

This action commit multiple files over the GitHub API by pushing blobs and adding them to a tree. It commit all staged files.

<details>
  <summary style="font-size:1.2em;">Table of Contents</summary>
<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->

- [User Story](#user-story)
- [The Idea](#the-idea)
- [Limitations](#limitations)
- [What's new](#whats-new)
- [Usage](#usage)
- [License](#license)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->
</details>

## User Story

As a user I want to push and commit multiple files in 1 commit. if doing it via git push, there is no way to sign the the commit in an action context.
Of course I want to use `only signed commits` restriction on my branches (and I dont want to bypass the restriction to protect my software supply chain).

## The Idea

It is possible to create blobs and tree to create a commit via GitHub API.
I found the solution to the problem here: <https://siddharthav.medium.com/push-multiple-files-under-a-single-commit-through-github-api-f1a5b0b283ae>

Thanks for your work [Siddhartha Varma](https://github.com/BRO3886).

## Limitations

:warning: the only limitation is that it can not be used on empty repositories.

## What's new

- First implementation is currently tested

## Usage

<!-- start usage -->

```yaml
- uses: tyriis/multi-file-commit@v0.1.0
  with:
    # Repository name with owner. For example, actions/checkout
    # Default: ${{ github.repository }}
    repository: ''

    # The branch you want to push the commit
    # Default: ${{ github.ref_name }}
    ref: ''

    # Personal access token (PAT) used to fetch the repository. The PAT is configured
    # with the local git config, which enables your scripts to run GitHub API commands.
    # Default: ${{ github.token }}
    token: ''

    # The commit message for the commit.
    message: ''

    # A list of files to commit, prevent other staged files to be commited.
    # Example: src/main.mjs,src/main.spec.js
    # If not set all staged files are considered for commit.
    files: ''
```

<!-- end usage -->

## License

The scripts and documentation in this project are released under the [MIT License](LICENSE)

<!-- Badges -->

[pre-commit-shield]: https://img.shields.io/badge/pre--commit-enabled-brightgreen?logo=pre-commit&style=for-the-badge
[pre-commit-url]: https://github.com/pre-commit/pre-commit
[taskfile-url]: https://taskfile.dev/
[taskfile-shield]: https://img.shields.io/badge/Taskfile-Enabled-brightgreen?logoColor=white&style=for-the-badge
