---
name: customize-resume
description: Tailor the user's base resume (and optionally a cover letter) to a specific job description without fabricating anything, then render an ATS-friendly PDF ready for job-apply. Use when the user asks to tailor, customize, or optimize a resume or CV for a job, or to write a cover letter. This stage is optional before applying.
argument-hint: "<job URL> | current-tab | <tracker id> [--cover-letter]"
---

# Customize resume

Produces `jobs/<folder>/resume.md`, `resume.pdf`, and optionally `cover-letter.md` and `.pdf`, tailored to one posting.

Read first: `references/shared/safety-rules.md` (rule 1 matters most here), `references/resume-rules.md`,
`references/shared/data-directory.md`, and `references/shared/browser.md`.

## Quick start

- `/job-copilot:customize-resume current-tab`: tailor for the posting open in Chrome
- `/job-copilot:customize-resume 12`: tracker id 12
- `/job-copilot:customize-resume https://jobs.lever.co/acme/… --cover-letter`

## Workflow

### Step 0: Prerequisites
`~/.job-search/resume/base-resume.md` and `profile.json` must exist. If they don't, run `setup` first.

### Step 1: Get the posting
1. Resolve the input. A tracker id → `tracker.py get --id N` gives the URL and the folder. `current-tab` → the active tab.
   A URL → open it in a new tab.
2. If a folder exists and its `posting.md` is less than 14 days old, reuse it. Otherwise:
   - `await window.jobCopilot.extractJob()`. Without the extension, use `get_page_text` (fine on a single posting).
     For Greenhouse, Lever, or Ashby, the JSON APIs in the job-search portal playbooks give clean text.
   - Create the folder: `tracker.py slug --company "<c>" --title "<t>"`, then `mkdir -p`.
   - Write `posting.md` with the URL, company, title, location, salary, the date fetched, and then the full
     description.
3. If the job isn't tracked yet, run `tracker.py add …`.

### Step 2: Analyze
1. Run `python3 <this-skill-dir>/scripts/keyword_gap.py <folder>/posting.md ~/.job-search/resume/base-resume.md`.
2. Write down, briefly, for yourself:
   - the must-haves (5–8) and nice-to-haves
   - for each must-have, the strongest evidence in the base resume, or "none"
   - the 2–3 themes the role cares most about (for example scale, ownership, customer-facing work)
3. If an important must-have has no evidence but plausibly could, ask the user **one consolidated question**
   ("The role wants Airflow and dbt. Have you used either? Where, roughly?"). Use their answers, and record new facts in
   the base resume's notes. Don't edit the base resume itself unless the user agrees.

### Step 3: Tailor
Write `<folder>/resume.md` from `base-resume.md`, following `references/resume-rules.md`:
- Rewrite the summary for this role (2–3 lines that name the target title and the top themes).
- Reorder and rephrase bullets to lead with the matching evidence. Mirror the posting's terms where they're accurate.
- Reorder skills so the matching must-haves come first. Remove clutter that doesn't matter here.
- Keep titles, companies, dates, and numbers exactly as they are.

### Step 4: Render
```bash
python3 <this-skill-dir>/scripts/render_resume.py <folder>/resume.md
```
If it warns that the PDF is over the page limit, tighten it and render again (or pass `--style compact`). Rename the PDF
or copy it to `<First>-<Last>-Resume-<Company>.pdf` in the same folder.

### Step 5: Cover letter (optional)
Only if `--cover-letter` was passed, the posting requires one, or preferences say "always". 250–350 words:
- Opening line: the role, plus one specific reason this company or role, taken from the posting (not flattery).
- Two short paragraphs: the two strongest pieces of matching evidence, with numbers.
- Close: availability and a thank-you. Sign it with the profile name.
- Same truthfulness rules apply. No em dashes and no clichés.

Save it as `cover-letter.md` and render it with the same script.

### Step 6: Self-review and present
Do the self-review in `references/resume-rules.md`, then show the user:
- the coverage before and after (from keyword_gap), with must-haves marked ✓, ~, or ✗
- a short "what changed" list (summary rewritten, 4 bullets reordered, 2 condensed, skills reordered)
- the anything-new-needs-confirmation list, if any
- the PDF path

Update the tracker: `tracker.py update --id N --status tailored --folder jobs/<folder>`.

### Step 7: Hand off
Suggest `/job-copilot:job-apply <tracker id>`. job-apply attaches `<folder>/*.pdf` automatically through the extension.
The user can also set it as the active resume in Job Copilot's options.
