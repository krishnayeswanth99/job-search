---
name: job-apply
description: Apply to a job in Chrome. Opens the posting, follows the Apply button to the ATS (Greenhouse, Lever, Ashby, Workday, LinkedIn Easy Apply, Indeed Apply, others), pauses for the user to sign in or sign up when required, autofills the form with the Job Copilot extension, drafts answers to custom questions, attaches the tailored resume, and submits only after the user confirms. Use when the user says apply, submit an application, autofill this form, or "apply to my shortlisted jobs".
argument-hint: "current-tab | <job URL> | <tracker id> | shortlisted [N]"
---

# Job apply

Read first: `references/shared/safety-rules.md` (rules 2–4 matter most here), `references/shared/browser.md`,
`references/shared/data-directory.md`, and `references/answering-questions.md`. Load the ATS playbook from `ats/` for
the site you end up on.

## Quick start

- `/job-copilot:job-apply current-tab`: fill the application form (or posting) open right now
- `/job-copilot:job-apply 12`: tracker id 12
- `/job-copilot:job-apply shortlisted 5`: work through up to 5 shortlisted or tailored jobs, one at a time

## ATS playbooks

| Detected on | File |
|---|---|
| `greenhouse.io`, or a `#grnhse_iframe` embed | `ats/greenhouse.md` |
| `lever.co` | `ats/lever.md` |
| `ashbyhq.com` | `ats/ashby.md` |
| `myworkdayjobs.com` | `ats/workday.md` |
| LinkedIn "Easy Apply" | `ats/linkedin-easy-apply.md` |
| A job board or aggregator that sends you elsewhere (LinkedIn "Apply", Indeed "Apply on company site", Jobright, Glassdoor, ZipRecruiter) | `references/boards-and-redirects.md` first, then the destination's playbook |
| Indeed "Easily apply" (`smartapply.indeed.com`) | `ats/indeed.md` |
| anything else (iCIMS, SmartRecruiters, Taleo, SuccessFactors, custom) | `ats/generic.md` |

## Workflow

### Step 0: Prerequisites and queue
1. `profile.json` must exist (run `setup` if it doesn't). Check the daily cap in `preferences.md` against
   `tracker.py list --status applied` for today.
2. Build the queue:
   - `current-tab` is the active tab.
   - A URL or tracker id is a single job.
   - `shortlisted N` comes from `tracker.py list --status shortlisted,tailored --limit N`. Prefer High fit.
3. For each job, set `tracker.py update --id N --status applying`.

### Step 1: Pick the resume
- If `<folder>/` has a tailored PDF from customize-resume, use it. Start the local file server in the background:
  ```bash
  python3 <this-skill-dir>/scripts/serve_files.py ~/.job-search/jobs/<folder> --port 8765 --minutes 20
  ```
- Otherwise the extension attaches the base resume stored in its options automatically.
- If the preferences say to tailor High-fit jobs and nothing is tailored yet, offer to run `customize-resume` first.

### Step 2: Reach the application form
1. Open the job URL (or use the current tab). Run `await window.jobCopilot.detect()`.
2. If `pageType` is `job`, read `extractJob()` and save or refresh `<folder>/posting.md` if it's missing.
3. Get to the form by following `references/boards-and-redirects.md`. In short:
   - `detect().apply.kind === 'easy-apply'` means an on-site flow (LinkedIn or Indeed). Click it and use that playbook.
   - Otherwise call `await jobCopilot.followApply()`. It goes to the employer's page **in the same tab** when the link is
     known, and steps through redirect hops and "You're leaving…" screens.
   - If it says the button is scripted, click it. Then find the new tab via `detect().openedTabs` or
     `tabs_context_mcp`.
4. Run `detect()` again on the destination. Load the matching `ats/*.md` playbook, and record the ATS URL with
   `tracker.py update --id N --apply-url <url>`.

### Step 3: Login, signup, and verification walls
If `detect().login.required` is true (or you see a sign-in, create-account, or "verify your email" step):
1. Stop and tell the user exactly what's needed, for example:
   > Workday (Acme) needs an account to apply. Please **create an account or sign in** in the open tab. Use
   > `ada@example.com` if you like. Reply **done** when you're on the application form.
2. If the user asks you to, you may fill **non-secret** signup fields (name, email) using `fillField`, but never
   passwords, codes, or CAPTCHAs.
3. When they reply "done", run `detect()` again. If it's still walled, ask again with what you see. After two failed
   rounds, mark it `blocked` and move on.

Details for each portal are in `references/login-and-signup.md`.

### Step 4: Autofill
1. Run `await window.jobCopilot.autofill()`. It fills the standard fields and the saved answers, and attaches the base
   resume.
   - If it fails with "not a trusted job site", ask the user to click **Autofill this application** in the Job Copilot
     popup, then continue from the scan step.
   - If the extension isn't installed, fill fields with `read_page` (interactive) plus `form_input`, using
     `profile.json`.
2. If there's a tailored resume, run
   `await window.jobCopilot.attachFile({ kind: 'resume', url: 'http://127.0.0.1:8765/<file>.pdf' })`.
   Do the same for a cover letter if the form has the field.
3. Look at `needsInput`. For each item, draft an answer following `references/answering-questions.md`.
   - Factual items you can't answer from the profile go into a question list for the user.
   - Consent checkboxes go into the confirmation list.
   - Custom dropdowns (`combobox: true`): click the control with `computer`, type `suggested`, wait, then click the
     option.

### Step 5: One consolidated check-in (ask once, fill once)
Send the user **one** message containing:
- the job (title, company, link) and the resume being attached
- your drafted answers to the custom questions (short, editable)
- the facts you need from them (if any)
- the consent and attestation boxes you plan to tick

Then wait. Apply their edits in one pass:
`await window.jobCopilot.autofill({ overrides: { "<selector>": "<answer>", … } })` or `fillField(...)` for each field.

### Step 6: Multi-page forms
For Workday, Easy Apply, iCIMS and similar, after each page:
`scanForm()` → check that the required fields have values → click **Next** or **Continue** (never **Submit** at this
stage) → `detect()` → `autofill()` again on the new page → repeat. If a page shows validation errors, read them with
`find("error messages")`, fix them, and continue.

### Step 7: Review and submit
1. Take a screenshot of the final review page (`computer` → `screenshot`). Run `scanForm()` and confirm that every
   `required` field has `hasValue: true`.
2. Ask: "Everything is filled for **<title> at <company>**. Submit now?" Submit only after a clear yes (safety rule 3).
3. Click the submit button. Wait, then confirm success with a "Thank you" or "Application received" message, a
   confirmation URL, or an email notice. If you can't see confirmation, say so. Don't assume it worked.

### Step 8: Record
- Write `<folder>/application.md` with the date, URL, ATS, resume file, every custom question and the answer given, and
  the confirmation text.
- Run `tracker.py update --id N --status applied --folder jobs/<folder>`. On failure, use `--status blocked --notes
  "<why>"`.
- Add new reusable answers to `profile.json` → `answers`, and remind the user to re-import it in the extension options.
- Stop the file server if it's still running (kill the background task).

If the job board's tab asks **"Did you apply?"** when you go back, answer **Yes** only after the confirmation in step 7.
Otherwise answer **No** (see `references/boards-and-redirects.md`).

### Step 9: Next job
In queue mode, give a short summary line per job and continue with the next one. Ask about submitting for each job
separately unless the user said to submit without asking.

## Final report
A table of job, status (applied, blocked, or skipped), and notes, plus what's left in the queue and tomorrow's cap.
