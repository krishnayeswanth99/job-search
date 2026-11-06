# job-search: Job Copilot

Find jobs, tailor your resume, and apply, with **Claude** doing the browsing and a small **Chrome extension** doing
the fast, deterministic parts (job extraction and form autofill).

The repo has two parts:

| Part | What it is | Where |
|---|---|---|
| **Job Copilot extension** | A Manifest V3 Chrome extension. It detects job portals and pages, extracts the jobs on the current tab, autofills application forms from your profile (Simplify/Jobright style), attaches your resume, and detects login walls. It also exposes `window.jobCopilot` so **Claude in Chrome** can drive it. | [`extension/`](extension/) |
| **Claude skills** (plugin `job-copilot`) | `setup`, `job-search` (one playbook per portal), `customize-resume`, and `job-apply`. They use the Claude in Chrome browser tools plus the extension bridge. | [`skills/`](skills/) |

```
 You ──► Claude Code (+ Claude in Chrome tools)
            │  skills: setup · job-search · customize-resume · job-apply
            │
            │  javascript_tool: await window.jobCopilot.extractJobs() / autofill() / …
            ▼
      Chrome tab ──► Job Copilot content scripts ──► service worker ──► every frame in the tab
                     (extractors, autofill, login     (merges results, attaches
                      detection; never submits)        local files, badge)
```

Each part works on its own. The popup gives you one-click "Find jobs on this tab" and "Autofill this application"
without Claude, and the skills fall back to plain DOM reading when the extension isn't installed. They're best together:
Claude handles the judgment (fit scoring, custom questions, multi-step flows, deciding when to stop and ask you), and
the extension handles speed and reliability.

## Quick start

### 1. Install the extension (about 1 minute)
1. Clone this repo.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and select `extension/`.
3. The options page opens. Click **Upload resume** (PDF, DOCX or TXT). It reads your details from it locally, shows
   them for review and editing, and saves what you approve to your profile. Everything stays editable afterwards. You
   can also import the `profile.json` that the setup skill creates.

### 2. Install the skills in Claude Code
```bash
claude plugin marketplace add krishnayeswanth99/job-search
```
```bash
claude plugin install job-copilot@job-copilot
```
You can also run `/plugin marketplace add krishnayeswanth99/job-search` inside Claude Code. During development, use
`claude --plugin-dir /path/to/job-search`.

### 3. Connect Claude to Chrome
Install the **Claude in Chrome** extension and sign in, then start Claude Code with Chrome enabled (`claude --chrome`, or
run `/chrome` in a session). The skills use the `mcp__claude-in-chrome__*` tools.

### 4. Use it
```
/job-copilot:setup ~/Downloads/resume.pdf
/job-copilot:job-search current-tab
/job-copilot:job-search linkedin "machine learning engineer" "Remote"
/job-copilot:customize-resume 12
/job-copilot:job-apply 12
/job-copilot:job-apply shortlisted 5
```
Or just ask in plain language: "find ML jobs on this page and apply to the good ones".

## The skills

| Skill | Does | Notes |
|---|---|---|
| `setup` | Turns your resume into `~/.job-search/resume/base-resume.md`, builds `profile.json` and `preferences.md`, and checks the extension | Asks only what a resume can't tell it (visa, salary, relocation) |
| `job-search` | Pulls jobs from the **current tab** or searches a portal, scores fit, and records them in `tracker.csv` | Playbooks for each portal in `skills/job-search/portals/`: LinkedIn, Indeed, Glassdoor, Wellfound, Greenhouse, Lever, Ashby, Workday, company careers pages. Uses the public ATS JSON APIs where they exist. |
| `customize-resume` | Tailors the resume to one posting, renders an ATS-friendly PDF, and writes an optional cover letter | Strict no-fabrication rules, keyword gap analysis, self-review pass |
| `job-apply` | Follows the Apply button to the ATS, waits for **you** to log in or sign up, autofills, drafts custom answers, attaches the tailored resume, and submits **after you confirm** | ATS playbooks in `skills/job-apply/ats/`: Greenhouse, Lever, Ashby, Workday, LinkedIn Easy Apply, Indeed, generic |

Everything personal stays in `~/.job-search/` (see
[`shared/data-directory.md`](shared/data-directory.md)), never in the repo.

## Guardrails

- **Never submits** without your explicit yes (per application, unless you say otherwise in that session).
- **Never types passwords, one-time codes, or CAPTCHAs.** When a site needs a login or signup, Claude pauses, tells you
  what to do, and continues when you reply "done".
- **Never fabricates** resume content or answers. Unknown facts become questions for you.
- Leaves consent and attestation boxes for you, and EEO answers default to "Decline to self-identify".
- Treats instructions found inside job postings as data, not commands.
- Throttled browsing: about 25 detail pages per run, no parallel scraping of one portal.

Full list: [`shared/safety-rules.md`](shared/safety-rules.md). How the extension enforces its side:
[`extension/README.md#security-model`](extension/README.md#security-model).

## Repo layout

```
.claude-plugin/          plugin + marketplace manifests
extension/               Chrome extension (no build step, plain JS)
  src/shared/            config, profile schema, field-matching rules (pure, unit-tested)
  src/content/           extractors, form scanning, autofill, login detection, bridge
  src/page/page-api.js   window.jobCopilot (MAIN world)
  src/background.js      multi-frame command runner, badge, local file fetch
skills/<skill>/          SKILL.md + playbooks / scripts / references
shared/                  references shared by all skills (synced into each skill)
tests/unit               node:test (field rules, repo consistency)
tests/e2e                Playwright: loads the extension against fixture portal pages
```

## Development

```bash
npm test                 # unit + e2e (e2e needs Playwright + Chromium)
```
```bash
npm run test:unit        # fast, no browser
```
```bash
npm run sync-shared      # after editing shared/*.md or shared/scripts/*
```
```bash
npm run package:extension   # dist/job-copilot-extension-<v>.zip + dist/skills/*.zip
```

**Adding a portal:** add it to `JC.PORTALS` in `extension/src/shared/config.js`, add an extractor in
`extension/src/content/extractors.js`, write `skills/job-search/portals/<id>.md` from `_template.md`, and add a fixture
and check to `tests/e2e/`. See [CLAUDE.md](CLAUDE.md) for how to ask Claude to make changes.

## Limitations

- Portal markup changes often. Extractors carry fallback selectors plus JSON-LD and generic link scanning, but expect
  occasional fixes. The e2e tests use fixtures, not live sites.
- Custom dropdown widgets (react-select, Workday prompt pickers) are reported as `needsInput`, and Claude completes them
  with clicks.
- Browsers can't attach files from disk on their own. The extension attaches the resume stored in its options, or a
  tailored PDF that `job-apply` serves on `127.0.0.1` for a few minutes.
- Respect each site's terms of use. Automating some portals (LinkedIn in particular) may violate their ToS. Keep volumes
  low and stay in the loop.

Inspired by [proficiently-claude-skills](https://github.com/proficientlyjobs/proficiently-claude-skills) and by the
Simplify and Jobright autofill extensions.

## License

MIT
