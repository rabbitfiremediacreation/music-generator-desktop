import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const stableTag = /^v\d+\.\d+\.\d+$/;
const previewTag = /^(daily|develop)-([1-9]\d*)$/;
const sectionStart = "<!-- desktop-update-notes:start -->";
const sectionEnd = "<!-- desktop-update-notes:end -->";
const maxChanges = 100;

async function output(command, args) {
  return (await execute(command, args, { maxBuffer: 16 * 1024 * 1024 })).stdout;
}

export async function previousRelease(releases, tag, isAncestor) {
  const current = previewTag.exec(tag);
  const published = releases.filter(release => !release.draft && release.tag_name !== tag);
  const stable = published.filter(release => !release.prerelease && stableTag.test(release.tag_name))
    .sort((a, b) => b.tag_name.localeCompare(a.tag_name, "en", { numeric: true }));
  const previews = current ? published
    .map(release => ({ release, match: previewTag.exec(release.tag_name) }))
    .filter(({ release, match }) => release.prerelease && match?.[1] === current[1] && BigInt(match[2]) < BigInt(current[2]))
    .sort((a, b) => b.release.tag_name.localeCompare(a.release.tag_name, "en", { numeric: true }))
    .map(({ release }) => release) : [];
  for (const candidate of [...previews, ...stable]) {
    if (await isAncestor(candidate.tag_name)) return candidate.tag_name;
  }
  return null;
}

const titleText = value => value.replace(/[\p{Cc}\s]+/gu, " ").trim();
const escapeHtml = value => value.replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]);
const escapeMarkdown = value => escapeHtml(value).replace(/[\\`*_{}\[\]()#+.!|~@]/g, "\\$&");
const referencedIssues = value => [...value.matchAll(/(?:^|[^\w/])#([1-9]\d*)\b/g)].map(match => Number(match[1]));
const prNumber = title => Number(/^Merge pull request #([1-9]\d*)\b/.exec(title)?.[1] ?? /\(#([1-9]\d*)\)\s*$/.exec(title)?.[1]);

export async function collectChanges(commits, { pull, issue }, repository) {
  const changes = [];
  const seenPulls = new Set();
  const issues = new Map();
  const pullRequests = new Map();
  for (const commit of commits) {
    const number = prNumber(commit.title);
    if (number && !pullRequests.has(number)) pullRequests.set(number, await pull(number));
    const pr = pullRequests.get(number);
    if (pr && seenPulls.has(number)) continue;
    if (pr) seenPulls.add(number);

    const linked = (pr?.closingIssuesReferences ?? [])
      .filter(item => item.url === `https://github.com/${repository}/issues/${item.number}`)
      .map(item => item.number);
    const refs = new Set([...linked, ...referencedIssues(`${commit.title}\n${commit.body}\n${pr?.body ?? ""}`)]);
    if (pr) refs.delete(number);
    const related = [];
    for (const ref of refs) {
      if (!issues.has(ref)) issues.set(ref, await issue(ref));
      const target = issues.get(ref);
      if (target && !target.pull_request) related.push({ number: ref, title: titleText(target.title) });
    }
    changes.push({
      title: titleText(pr?.title ?? commit.title),
      path: pr ? `pull/${number}` : `commit/${commit.sha}`,
      label: pr ? `#${number}` : commit.sha.slice(0, 7),
      related,
    });
  }
  return changes;
}

export function renderNotes(repository, revision, previous, changes, truncated = false) {
  const root = `https://github.com/${repository}`;
  const compare = previous ? `${root}/compare/${previous.sha}...${revision}` : `${root}/commits/${revision}`;
  const intro = previous ? `Changes since ${previous.tag}` : "Changes in this build";
  const mdLink = (text, href) => `[${escapeMarkdown(text)}](${href})`;
  const htmlLink = (text, href) => `<a href="${escapeHtml(href)}">${escapeHtml(text)}</a>`;
  const line = (change, link, escape) => {
    const primary = `${escape(change.title)} (${link(change.label, `${root}/${change.path}`)})`;
    const issues = change.related.map(item => link(`#${item.number} ${item.title}`, `${root}/issues/${item.number}`));
    return issues.length ? `${primary} · ${issues.join(", ")}` : primary;
  };
  const empty = "No source changes in this build.";
  const more = truncated ? "Showing the most recent changes. " : "";
  return {
    markdown: `## ${intro}\n\n${changes.length ? changes.map(change => `- ${line(change, mdLink, escapeMarkdown)}`).join("\n") : empty}\n\n${more}[Full change history](${compare})\n`,
    html: `<h2>${escapeHtml(intro)}</h2>\n${changes.length ? `<ul>\n${changes.map(change => `<li>${line(change, htmlLink, escapeHtml)}</li>`).join("\n")}\n</ul>` : `<p>${empty}</p>`}\n<p>${more}${htmlLink("Full change history", compare)}</p>`,
  };
}

export function mergeReleaseNotes(body, markdown) {
  const start = body.indexOf(sectionStart);
  const end = body.indexOf(sectionEnd);
  assert(start === -1 ? end === -1 : end > start, "Incomplete generated release notes section");
  const section = `${sectionStart}\n\n${markdown.trim()}\n\n${sectionEnd}`;
  if (start !== -1) return `${body.slice(0, start)}${section}${body.slice(end + sectionEnd.length)}`;
  return body.trimEnd() ? `${body.trimEnd()}\n\n${section}\n` : `${section}\n`;
}

async function optionalGitHub(args) {
  try {
    return JSON.parse(await output("gh", args));
  } catch (error) {
    if (/HTTP 404\b|Could not resolve to a PullRequest/.test(error.stderr ?? "")) return null;
    throw error;
  }
}

async function generate(repository, revision, tag) {
  const releases = JSON.parse(await output("gh", ["api", "--paginate", "--slurp", `repos/${repository}/releases?per_page=100`])).flat();
  const previous = await previousRelease(releases, tag, async name => {
    try {
      await output("git", ["merge-base", "--is-ancestor", `refs/tags/${name}^{commit}`, revision]);
      return true;
    } catch (error) {
      if (error.code === 1 || /Not a valid object name/.test(error.stderr ?? "")) return false;
      throw error;
    }
  });
  // Link against the commit so the comparison survives preview tag cleanup.
  const previousSha = previous ? (await output("git", ["rev-parse", `refs/tags/${previous}^{commit}`])).trim() : null;
  const range = previousSha ? `${previousSha}..${revision}` : revision;
  const log = await output("git", ["log", "--first-parent", `--max-count=${maxChanges + 1}`, "-z", "--format=%H%x1f%s%x1f%b", range, "--"]);
  const commits = log.split("\0").filter(Boolean).map(record => {
    const [sha, title, ...body] = record.split("\x1f");
    return { sha, title, body: body.join("\x1f") };
  });
  const changes = await collectChanges(commits.slice(0, maxChanges), {
    pull: async number => {
      const pr = await optionalGitHub(["pr", "view", String(number), "--repo", repository, "--json", "title,body,state,closingIssuesReferences"]);
      return pr?.state === "MERGED" ? pr : null;
    },
    issue: number => optionalGitHub(["api", `repos/${repository}/issues/${number}`]),
  }, repository);
  return renderNotes(repository, revision, previousSha ? { tag: previous, sha: previousSha } : null, changes, commits.length > maxChanges);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, file] = process.argv.slice(2);
  const { GITHUB_REPOSITORY: repository, GITHUB_SHA: revision, RELEASE_TAG, UPDATE_STREAM, GITHUB_RUN_NUMBER } = process.env;
  const tag = RELEASE_TAG || `${UPDATE_STREAM}-${GITHUB_RUN_NUMBER}`;
  assert(/^[\w.-]+\/[\w.-]+$/.test(repository), "Invalid release repository");
  assert(stableTag.test(tag) || previewTag.test(tag), "Invalid update notes tag");
  assert(file, "Missing update notes file");
  if (mode === "generate") {
    assert(/^[a-f0-9]{40}$/.test(revision), "Invalid source revision");
    const notes = await generate(repository, revision, tag);
    const runId = process.env.GITHUB_RUN_ID;
    const workflow = previewTag.test(tag) && /^[1-9]\d*$/.test(runId)
      ? `\n[Workflow run](https://github.com/${repository}/actions/runs/${runId})\n` : "";
    await mkdir(file, { recursive: true });
    await Promise.all([
      writeFile(path.join(file, "release-notes.md"), notes.markdown + workflow),
      writeFile(path.join(file, "release-notes.html"), notes.html),
    ]);
  } else if (mode === "publish") {
    const markdown = await readFile(file, "utf8");
    const release = JSON.parse(await output("gh", ["release", "view", tag, "--repo", repository, "--json", "body"]));
    const body = mergeReleaseNotes(release.body ?? "", markdown);
    if (body !== release.body) {
      const directory = await mkdtemp(path.join(tmpdir(), "music-release-notes-"));
      try {
        const notesFile = path.join(directory, "notes.md");
        await writeFile(notesFile, body);
        await output("gh", ["release", "edit", tag, "--repo", repository, "--notes-file", notesFile]);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  } else {
    throw new Error("Expected generate or publish");
  }
}
