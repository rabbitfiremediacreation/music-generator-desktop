# Music Generator documentation

This independent Astro/Starlight project publishes the German and English desktop documentation. It has its own dependencies and lockfile. The root Vite/Tauri build, package files and `.github/workflows/desktop.yml` are unchanged.

Scope agreed in [issue #6](https://github.com/rabbitfiremediacreation/music-generator-desktop/issues/6#issuecomment-6398632531): German and English, followed by text and screenshots from real installations in pull requests. The app's twelve interface languages do not imply twelve documentation languages.

## Local preview and validation

Use Node.js 24 or newer. From the repository root:

```sh
npm --prefix docs/site ci
npm --prefix docs/site run dev
```

Open `http://localhost:4321/music-generator-desktop/de/` or `http://localhost:4321/music-generator-desktop/en/`.

Before submitting a pull request:

```sh
npm --prefix docs/site run check
npm --prefix docs/site run build
npm --prefix docs/site run preview
```

Preview the production output at the same paths. Check both languages, the language selector, sidebar, search, edit links and narrow-screen layout. The generated site is in `docs/site/dist/`; never commit it or `node_modules/` or `.astro/`.

## Add or edit a page

| Location | Purpose |
| --- | --- |
| `src/content/docs/de/index.md` | German landing-page metadata |
| `src/content/docs/en/index.md` | English landing-page metadata |
| `src/data/landing.ts` | German and English product-page copy |
| `src/data/releases.ts` | Verified release, platform requirements, download and checksum links |
| `src/components/ProductLanding.astro` | Product page, screenshot preview and section layout |
| `src/components/Downloads.astro` | Platform downloads and optional Mac alternatives |
| `src/styles/landing.css` | Custom studio design and responsive landing-page layout |
| `src/styles/docs.css` | Matching documentation theme, including light mode |
| `src/content/docs/de/guides/` | German guides |
| `src/content/docs/en/guides/` | English guides with matching filenames |
| `src/assets/screenshots/` | Screenshots, processed by Astro, with provenance notes |
| `astro.config.mjs` | Site URL, language selection and navigation |

For example, add `guides/first-song.md` to both language directories. Use matching paths so the language selector stays on the same topic. Start each Markdown file with:

```yaml
---
title: First song
description: Create your first song with Music Generator Desktop.
sidebar:
  order: 2
---
```

Translate the title, description, prose and image descriptions. The sidebar automatically lists files under `guides/`; adding a guide does not require editing application code or navigation configuration. Starlight uses German as the fallback if a translation is still pending; say so in the PR and complete the English counterpart as a follow-up.

Use relative links between pages, including a trailing slash: from a landing page, `./guides/installation/`; from one guide to another, `../first-song/`. Do not link to Markdown source files for navigation. Relative links preserve the language and the GitHub Pages `/music-generator-desktop/` base path.

Each guide page has an **Edit page / Seite bearbeiten** link to its source on `main`. You can use GitHub's editor to propose a pull request. Existing technical references under `docs/` remain outside this site; link to them on GitHub when needed.

The two landing pages use `template: splash`; `PageFrame.astro` renders the custom product page only at the two language home URLs. Other routes, including 404 pages, retain Starlight's page frame. Edit the bilingual product text in `src/data/landing.ts`. Regular guide pages keep Starlight navigation, search, language selection and Markdown editing. For the download section, update `src/data/releases.ts` only after checking that every package and `.sha256` URL exists in the published release; missing editions must not receive guessed URLs.

The product images come from the existing `assets/music-generator-overview.png` in the repository root (README capture dated 25 October 2026). The hero shows the complete app; the library section shows a CSS crop of the same image. Both captions identify the capture and sample data. These are product views, not proof of a new installation or screenshots of the current download version. Astro generates local WebP variants at build time; no third-party image service is used. Replacing this root image also triggers the documentation workflow.

## Add real installation screenshots

Put PNG, JPEG or WebP files in `src/assets/screenshots/`, with descriptive names such as `windows-0.1.2-smartscreen-de.png`. From a guide in `de/guides/` or `en/guides/`, embed an image using:

```md
![Describe the visible step in the page's language.](../../../../assets/screenshots/windows-0.1.2-smartscreen-de.png)
```

Add the file only when you have the real screenshot; this example filename is not a bundled asset. Record the app version, OS version, hardware, UI language, capture date and the step shown in `src/assets/screenshots/README.md`. Include a translated caption when sharing an image across languages. Remove private paths or personal data before committing. Do not present existing development/PR images as evidence of a fresh installation. M1, Intel, Windows and M4 Mini walkthroughs can be added independently.

## Sources and versions

The installation guides and download section were checked on 27 October 2026 against the published **v0.1.2 pre-release**, its assets and its tagged `docs/desktop.md`, plus the installation observations in issue #6. The six packages and their six matching checksums exist. Release 0.1.2 has no separate Linux CUDA edition. This documentation change does not bump the desktop manifests in the local checkout.

Keep the checked date and release links on both installation pages current when updating download examples. Verify the actual release and asset filenames; a version in `main` alone does not prove that a download contains a feature. Use tagged source links for release-specific instructions. Historical `0.2.6` and `0.2.7` claims from the old desktop prose were not adopted: they did not match the desktop version, and the original feature introduction versions were not established. Do not assign a new introduction version without evidence.

Keep later hardware timings, download sizes and acceptance results tied to their exact version, model and computer. Do not turn an individual test result into a general performance promise.

## GitHub Pages

The separate `.github/workflows/docs.yml` validates documentation pull requests and builds on documentation changes to `main`. Only a successful `main` push or a manual run on `main` deploys to the `github-pages` environment. PR runs do not deploy or configure Pages. Only the deployment job receives Pages write and OIDC permissions. No desktop engine, Rust build or application release is needed to build this site.

A repository maintainer must select **Settings → Pages → Build and deployment → Source: GitHub Actions** once and allow the `github-pages` environment to deploy from `main`. After merge, the expected address is `https://rabbitfiremediacreation.github.io/music-generator-desktop/`, with German at `de/` and English at `en/`. This scaffold does not change repository settings or publish from the local checkout.

Framework references: [Starlight internationalization](https://starlight.astro.build/guides/i18n/), [Markdown authoring](https://starlight.astro.build/guides/authoring-content/) and [Astro on GitHub Pages](https://docs.astro.build/en/guides/deploy/github/).
