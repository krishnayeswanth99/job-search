---
name: setup
description: One-time onboarding for the job search toolkit. Imports the user's resume, builds ~/.job-search/profile.json and preferences.md, and connects the Job Copilot Chrome extension. Use when the user says "set up job search", "import my resume", "update my profile", or when another job skill finds no profile.
argument-hint: "[path to resume] | profile | preferences | check"
---

# Setup

Sets up `~/.job-search/` (see `references/shared/data-directory.md`) so the `job-search`, `customize-resume`, and
`job-apply` skills have what they need. Follow `references/shared/safety-rules.md` throughout.

## Quick start

- `/job-copilot:setup ~/Downloads/resume.pdf`: full onboarding from a resume file
- `/job-copilot:setup profile`: review or edit profile fields only
- `/job-copilot:setup preferences`: edit search preferences only
- `/job-copilot:setup check`: verify the data directory, the extension, and Claude in Chrome

## Workflow

### Step 0: Initialize

```bash
python3 <this-skill-dir>/references/shared/scripts/tracker.py init
```

If `profile.json` already exists, load it and only fill the gaps. Never overwrite the user's edits without asking.

### Step 1: Resume → `resume/base-resume.md`

1. Get the resume path from the argument, or ask for it. PDF, DOCX, and Markdown/TXT all work.
2. Extract the text. Use Read for PDFs. For DOCX, run `pandoc file.docx -t gfm` if pandoc is available, or
   `python3 -c "import zipfile,re,sys; x=zipfile.ZipFile(sys.argv[1]).read('word/document.xml').decode(); print(re.sub(r'<[^>]+>',' ',x.replace('</w:p>','\n')))" file.docx`.
3. Rewrite it as clean Markdown with this structure. Keep every fact and add nothing:
   ```markdown
   # Full Name
   City, Country · email · phone · linkedin · github
   ## Summary
   ## Experience
   ### Title — Company · Location · Mon YYYY – Mon YYYY
   - achievement bullet
   ## Skills
   ## Education
   ## Projects / Certifications (if present)
   ```
4. Copy the original file to `~/.job-search/resume/original.<ext>`.

### Step 2: Profile → `profile.json`

1. Start from `assets/profile.template.json`. Fill whatever the resume states: name, email, phone, city, country,
   links, current title and company, school, degree, graduation year, and years of experience (compute it from the
   dates and say how you got it).
2. Ask the user only for what a resume can't tell you, in **one** consolidated message:
   - work authorization and sponsorship need (for each target country, if there are several)
   - willingness to relocate, preferred work arrangement, notice period, earliest start date
   - desired salary (or "prefer not to say", in which case leave it blank and job-apply will ask each time)
   - how they usually heard about jobs (default answer: LinkedIn)
   - EEO answers: default "Decline to self-identify". Only change them if the user offers.
3. Seed `answers` with 3–5 reusable custom answers drafted from the resume, such as "Why are you looking for a new
   role?" and "Tell us about yourself". Mark them as drafts and get the user to approve or edit them.
4. Write `profile.json`. Validate it with `python3 -m json.tool ~/.job-search/profile.json > /dev/null`.

### Step 3: Preferences → `preferences.md`

Copy `assets/preferences.template.md`, then fill it in through a short conversation: target titles, locations,
salary floor, portals to search, deal-breakers, and daily cap. Suggest sensible defaults based on the resume.

### Step 4: Connect the Job Copilot extension

1. Tell the user how to install it if they haven't:
   `chrome://extensions` → Developer mode → **Load unpacked** → choose the repo's `extension/` folder.
2. In Job Copilot's options page (it opens on install), have them:
   - **Import profile.json** from `~/.job-search/profile.json`
   - choose their resume PDF under **Resume** (it gets attached to upload fields automatically)
3. Verify with Claude in Chrome (`references/shared/browser.md`): open a tab on any careers page (for example
   `https://jobs.lever.co/`) and run `window.jobCopilot && window.jobCopilot.installed` with `javascript_tool`.
   - `true`: connected.
   - `null` or `false`: ask them to reload the tab. If it's still missing, the extension isn't loaded. The other skills
     still work through fallbacks, just slower.

### Step 5: Summary

Show the profile highlights, preferences, and what's still missing. Suggest a next step:
`/job-copilot:job-search linkedin "<top title>"` or `/job-copilot:job-search current-tab`.

## `check` mode

Report a ✓ or ✗ for each of these: data directory, `base-resume.md`, `profile.json` (required fields filled),
`preferences.md`, Claude in Chrome connected (`tabs_context_mcp` works), and the Job Copilot bridge on a test tab.

## Permissions

Add these to `~/.claude/settings.json` so the skills don't prompt on every file write:

```json
{ "permissions": { "allow": ["Read(~/.job-search/**)", "Write(~/.job-search/**)", "Edit(~/.job-search/**)", "mcp__claude-in-chrome__*"] } }
```
