# CLAUDE.md

Guidance for Claude (and humans) changing this repo.

## What lives where
- `extension/`: the Chrome MV3 extension. Plain scripts sharing a `globalThis.JC` namespace, with **no bundler**, so
  keep each file loadable on its own in the order `manifest.json` lists them.
- `skills/<name>/SKILL.md`: the Claude skills (plugin `job-copilot`). Portal-specific knowledge belongs in
  `skills/job-search/portals/<id>.md` and `skills/job-apply/ats/<id>.md`, not in SKILL.md.
- `shared/`: references used by several skills. **Edit here, then run `npm run sync-shared`.** The copies in
  `skills/*/references/shared/` are generated.

## Rules
- The profile schema lives in `extension/src/shared/profile-schema.js`. If you change it, regenerate
  `skills/setup/assets/profile.template.json` (the unit test `repo.test.mjs` checks they match) and update
  `shared/data-directory.md`.
- Field-matching logic goes in `src/shared/field-rules.js` (pure, no DOM), with a case in
  `tests/unit/field-rules.test.mjs`.
- A new portal needs four things: an entry in `JC.PORTALS`, an extractor in `src/content/extractors.js`, a playbook from
  `portals/_template.md`, and an e2e fixture plus check.
- Never weaken the guardrails: no auto-submit, no typing passwords or OTPs, no fabricated content, no profile values
  returned through the bridge, and bridge writes only on trusted domains.
- Bump `version` in `extension/manifest.json`, `JC.VERSION` (`src/shared/config.js`), and `.claude-plugin/plugin.json`
  together. A test enforces this.

## Checks before committing
```bash
npm run check        # shared refs in sync + unit tests
```
```bash
npm run test:e2e     # needs Playwright + Chromium
```

## Asking for changes
Good requests name the portal or ATS and paste a snippet of the page's HTML (or the output of
`jobCopilot.scanForm()`). For example: "Indeed changed its job cards. Here's the outer HTML of one card; update the
extractor and the fixture."
