---
name: pull-request
description: Create or update pull requests in this repository, include screenshots for UI changes and new features, verify CI, and link downloadable build artifacts for testing.
---

# Pull requests

Use this skill when asked to create or update a pull request in this repository, including following its CI builds and making the resulting packages easy to test.

## Prefer the GitHub CLI

- Check `command -v gh` and `gh auth status`. When installed and authenticated, use `gh` for PR creation, edits, CI inspection and artifact discovery, including API calls through `gh api`.
- If the CLI is unavailable or cannot perform an operation with its current authentication, use an available GitHub connector or browser. Explain the limitation briefly; do not expose tokens or change authentication without authorization.
- Resolve the repository and target branch from Git and the task. Keep unrelated changes out of the PR; use a `codex/` branch unless the user specifies another name.
- Describe the problem, resulting behavior and actual validation. Link the originating issue; use `Closes #NUMBER` only when the PR fully resolves it.
- Use a temporary UTF-8 file with actual newlines for `gh pr create --body-file FILE` and `gh pr edit NUMBER --body-file FILE`. Before editing an existing PR, read its current body and preserve unrelated text and reviewer additions.
- Creating a PR does not by itself authorize merging it, tagging a release or publishing release assets.

## Include images for UI changes and new features

- For changes to the interface **or any new feature**, include real screenshots in the PR description showing the changed interface or observable feature behavior. For a feature without a UI, an image of its actual output or integration behavior is appropriate.
- Capture the implemented revision in a representative state. For visual changes, include before/after images when they help reviewers assess the difference. Identify simulated data or mocked services in the caption.
- Embed the images with Markdown and a short caption. Use an accessible GitHub-hosted attachment, or commit focused screenshots under `docs/pr/TOPIC/` and embed a GitHub image URL pinned to the PR head commit, for example:

  ```markdown
  ![Changed feature](https://github.com/OWNER/REPO/blob/HEAD_SHA/docs/pr/TOPIC/feature.png?raw=true)
  ```

- Local filesystem paths are not usable image links in a GitHub PR. Do not substitute fabricated screenshots or an unrelated existing README image for evidence of the change.
- If a required screenshot cannot be captured or hosted, keep the PR in draft and explain what evidence is missing. Documentation-only, skill-only and CI-only changes do not need images unless they also add a feature or change the interface.

## Verify the current CI builds

- Read `.github/workflows/desktop.yml` to determine the expected jobs and package outputs for the triggering event. Inspect checks with `gh pr checks NUMBER` and identify the run for the current PR head, rather than accepting a successful older revision.
- Inspect progress with `gh run view RUN_ID --json headSha,status,conclusion,jobs,url`. Follow builds through tests, package verification and uploads; report meaningful progress while waiting.
- On failure, inspect `gh run view RUN_ID --log-failed`, fix issues within the task's scope, push the correction and verify the new revision. Do not repeatedly rerun a deterministic failure or hide a failing check. Explain external blockers and any remaining failures.
- If no workflow was triggered, state that explicitly. Do not describe missing checks as successful or trigger a release to obtain packages.

## Link downloadable packages after the build

After the GitHub build jobs finish, update the PR description with a **Test builds** section containing the source commit, workflow-run link and one direct download link for each available platform package artifact.

Discover artifacts from that exact run using the CLI:

```sh
gh api --paginate repos/OWNER/REPO/actions/runs/RUN_ID/artifacts \
  --jq '.artifacts[] | select(.expired == false and (.name | startswith("Music-Generator-"))) | {id, name}'
```

- Link each returned package artifact as `https://github.com/OWNER/REPO/actions/runs/RUN_ID/artifacts/ARTIFACT_ID`. Use the returned IDs; do not invent URLs or use authenticated API ZIP endpoints as reviewer-facing links.
- Label links by platform, such as macOS arm64, macOS Intel, Windows x64 and Linux Vulkan. Include Linux CUDA only when that run actually produced it. Runtime-cache artifacts are not installable test packages.
- Confirm that the corresponding job passed package verification and upload before presenting its artifact as tested. If only some jobs succeeded, link those packages and clearly identify the failed or missing platforms.
- These links download GitHub artifact ZIPs containing the packages and checksums; they require repository access and remain available until artifact expiration. Do not describe them as published releases.
- When a new commit triggers another build, mark older links with their source revision while it runs, then replace them with links from the new run. Never present packages from an older revision as the current PR build.
- Verify that the final PR body renders the images and artifact links. Report the PR URL, actual CI outcome and any missing evidence to the user.
