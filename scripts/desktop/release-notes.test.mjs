import assert from "node:assert/strict";
import test from "node:test";
import { appcastXml, macUpdateRelease } from "./macos-updater.mjs";
import { collectChanges, mergeReleaseNotes, previousRelease, renderNotes } from "./release-notes.mjs";

const repository = "owner/desktop";
const head = "c".repeat(40);
const base = "d".repeat(40);
const release = (tag_name, prerelease, draft = false) => ({ tag_name, draft, prerelease });

test("uses the previous published ancestor from the same stream, then Stable", async () => {
  const releases = [
    release("develop-13", true),
    release("develop-12", true),
    release("daily-11", true),
    release("develop-10", true, true),
    release("develop-9", true),
    release("develop-8", true),
    release("v0.2.0", false),
    release("v0.1.9", false),
  ];
  const ancestors = new Set(["develop-12", "daily-11", "develop-8", "v0.1.9"]);
  const isAncestor = tag => ancestors.has(tag);
  assert.equal(await previousRelease(releases, "develop-12", isAncestor), "develop-8");
  assert.equal(await previousRelease(releases, "daily-11", isAncestor), "v0.1.9");
  assert.equal(await previousRelease(releases, "v0.3.0", isAncestor), "v0.1.9");
});

test("links PR titles, direct commit subjects and local issues safely in Markdown and Sparkle", async () => {
  const commits = [
    { title: "Merge pull request #12 from feature", body: "", sha: "a".repeat(40) },
    { title: "Fix audio export (#12)", body: "", sha: "b".repeat(40) },
    { title: "Tweak cache (#41)", body: "See #42 and owner/other#99", sha: head },
  ];
  const fetchedIssues = [];
  const changes = await collectChanges(commits, {
    pull: async number => number === 12 ? {
      title: "Fix <script> & [export]",
      body: "Closes #40, see #43",
      closingIssuesReferences: [
        { number: 39, url: "https://github.com/owner/desktop/issues/39" },
        { number: 99, url: "https://github.com/owner/other/issues/99" },
      ],
    } : null,
    issue: async number => {
      fetchedIssues.push(number);
      return { title: `Issue ${number} ]]> <img>`, pull_request: number === 43 ? {} : undefined };
    },
  }, repository);
  assert.deepEqual(fetchedIssues, [39, 40, 43, 41, 42]);
  assert.deepEqual(changes.map(change => change.path), ["pull/12", `commit/${head}`]);
  assert.deepEqual(changes[0].related.map(issue => issue.number), [39, 40]);

  const notes = renderNotes(repository, head, { tag: "develop-10", sha: base }, changes);
  for (const note of [notes.markdown, notes.html]) {
    assert(note.includes("https://github.com/owner/desktop/pull/12"));
    assert(note.includes(`https://github.com/owner/desktop/commit/${head}`));
    assert(note.includes("https://github.com/owner/desktop/issues/39"));
    assert(note.includes("https://github.com/owner/desktop/issues/41"));
    assert(note.includes(`https://github.com/owner/desktop/compare/${base}...${head}`));
    assert(!note.includes("/issues/43"));
    assert(!note.includes("<script>"));
    assert(!note.includes("]]>"));
  }
  assert(notes.markdown.includes("Fix &lt;script&gt; &amp; \\[export\\]"));
  const settings = macUpdateRelease({ MUSIC_GENERATOR_REQUIRE_NOTARIZATION: "true", MUSIC_GENERATOR_UPDATE_BUILD: "develop-12" }, "0.2.0");
  assert(appcastXml(settings, "fixture.zip", "14.0", "signature", 42, notes.html)
    .includes(`<description><![CDATA[${notes.html}]]></description>`));
});

test("refreshes the generated Stable notes without duplicating or replacing handwritten text", () => {
  const manual = "## Maintainer notes\n\nImportant compatibility details.\n";
  const markdown = renderNotes(repository, head, { tag: "v0.2.0", sha: base }, []).markdown;
  const original = mergeReleaseNotes(manual, markdown);
  assert(original.startsWith(manual));
  assert(original.includes("No source changes"));
  assert.equal(mergeReleaseNotes(original, markdown), original);
  const edited = mergeReleaseNotes(original + "\nManual follow-up.\n", "## Updated notes");
  assert(edited.includes("## Updated notes"));
  assert(edited.endsWith("Manual follow-up.\n"));
  assert(!edited.includes("No source changes"));
});
