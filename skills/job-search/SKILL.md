---
name: job-search
description: Find jobs on job portals (LinkedIn, Indeed, Glassdoor, Wellfound, Greenhouse, Lever, Ashby, Workday, company career pages) or pull the jobs already open in the current Chrome tab, score them for fit against the user's profile, and track them. Use when the user asks to find, search, scan, or list jobs, or says "what jobs are on this page".
argument-hint: "current-tab | <portal> \"<keywords>\" [location] | all \"<keywords>\" | status"
---

# Job search

Finds jobs, scores fit, and records everything in `~/.job-search/tracker.csv`. It does **not** tailor resumes or apply.
Hand those off to `customize-resume` and `job-apply`.

Read first: `references/shared/safety-rules.md`, `references/shared/browser.md`, `references/shared/data-directory.md`.
Each portal has its own playbook in `portals/<portal>.md`. Load only the one you need.

## Quick start

| Command | What it does |
|---|---|
| `/job-copilot:job-search current-tab` | Lists, scores, and tracks the jobs on the tab the user is looking at |
| `/job-copilot:job-search linkedin "ml engineer" "Remote"` | Searches one portal |
| `/job-copilot:job-search all "data engineer"` | Searches every portal listed in `preferences.md` |
| `/job-copilot:job-search https://jobs.lever.co/acme` | Scans one company's board |
| `/job-copilot:job-search status` | Summarizes the tracker |

## Portal playbooks

| Portal | File | Login needed to search? |
|---|---|---|
| LinkedIn | `portals/linkedin.md` | Recommended (guest results are limited) |
| Indeed | `portals/indeed.md` | No |
| Glassdoor | `portals/glassdoor.md` | Often (wall after a few views) |
| Wellfound | `portals/wellfound.md` | Yes |
| Greenhouse boards | `portals/greenhouse.md` | No |
| Lever boards | `portals/lever.md` | No |
| Ashby boards | `portals/ashby.md` | No |
| Workday sites | `portals/workday.md` | No (only to apply) |
| Any company careers page | `portals/company-careers.md` | No |
| Jobright, Simplify, ZipRecruiter, Dice, Built In (aggregators) | `portals/jobright.md` | Often |

To add a portal, write `portals/<id>.md` following `portals/_template.md`. If a dedicated extractor would help, add one to
`extension/src/content/extractors.js`.

## Workflow

### Step 0: Prerequisites

1. `~/.job-search/profile.json` and `resume/base-resume.md` must exist. If they don't, run the `setup` skill first, or
   ask the user to.
2. Read `preferences.md`: titles, locations, salary floor, deal-breakers, excluded companies.
3. Check that Claude in Chrome responds (`tabs_context_mcp`).

### Step 1: Pick the mode

- **current-tab**: use the user's active tab from `tabs_context_mcp`. Don't navigate away from it.
- **portal + keywords**: open a new tab (`tabs_create_mcp`). Build the search URL from the portal playbook, using the
  keywords plus the location and filters from preferences.
- **URL**: open it and treat it as current-tab.
- **all**: run the portal mode for each portal in preferences, one after another, never in parallel.

### Step 2: Detect and handle walls

Run `await window.jobCopilot.detect()`.
- If `login.required` is true, tell the user: "<Portal> wants you to sign in or create an account. Please do that in the
  open tab and reply **done**." Then wait. When they reply, run `detect()` again. Never type credentials.
- If there's a CAPTCHA or bot check, ask the user to solve it, the same way.
- If `pageType` is `job` rather than `listings`, there's a single posting: extract it (Step 4) and skip pagination.

### Step 3: Extract listings

1. Run `await window.jobCopilot.extractJobs({ limit: 100 })`. For infinite-scroll feeds (Jobright, LinkedIn, Indeed,
   Wellfound), run `await window.jobCopilot.loadMoreJobs({ rounds: 8 })` to scroll and collect more. It keeps jobs
   that have already scrolled away. If it still returns 0, use the playbook's fallback snippet. Never use
   `get_page_text` on a listings page.
2. Paginate as the playbook says, up to `pages` (default 3) or about 75 jobs, whichever comes first.
3. Drop duplicates. For each job, run `tracker.py exists --url <url>` and skip any that are already tracked, unless
   the user asked for a rescan.
4. Drop obvious non-matches without opening them: excluded companies, title has an avoided keyword, location is
   incompatible.

### Step 4: Read the promising ones

Pick the top candidates by title match, at most 25 per run (safety rule 7). For each one:
1. Open it in your tab. On LinkedIn you can click the card instead, which keeps you on the search page.
2. `await window.jobCopilot.extractJob()` gets the description, salary, and apply-button text.
3. Score it with `references/fit-scoring.md`. Keep the evidence short: matched must-haves, gaps, and deal-breakers.
4. Note the **apply route**: Easy Apply or Indeed Apply (on-site), or an external ATS (Greenhouse, Lever, Workday and so
   on, which you can often tell from `apply.href`).

### Step 5: Record

For each scored job:

```bash
python3 <this-skill-dir>/references/shared/scripts/tracker.py add --portal <id> --company "<c>" --title "<t>" --url "<url>" --location "<l>" --fit <High|Medium|Low|Skip> --status found --notes "<one-line why + apply route>"
```

Set the status to `shortlisted` for High fit jobs. Also write a run log to
`~/.job-search/searches/<date>-<portal>-<keywords-slug>.md` with the query URL, counts, and the scored table.

### Step 6: Report

Reply with a compact table of High and Medium jobs only, best first:

| # | Fit | Title | Company | Location | Salary | Apply via | Tracker id |
|---|---|---|---|---|---|---|---|

Then add one line of counts: "Scanned 62, new 41, read 18: 5 High, 7 Medium, 6 Low/Skip."

Then suggest next steps:
- `/job-copilot:customize-resume <tracker id>` for High fits
- `/job-copilot:job-apply <tracker id>` or `/job-copilot:job-apply shortlisted`

When the user gives feedback ("no agencies", "too junior"), add it to the **Feedback log** in `preferences.md` and apply
it to future runs.

## `status` mode

Run `tracker.py stats` and `tracker.py list --status shortlisted,tailored,applying --limit 20`, then summarize them.
