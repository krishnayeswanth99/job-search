# Data directory: `~/.job-search/`

Everything the skills read and write lives here, outside the repo, so it persists across plugin updates and never gets
committed. Override it with the `JOB_SEARCH_HOME` environment variable.

```
~/.job-search/
├── profile.json            # structured profile: same schema as the Job Copilot extension (import it there)
├── resume/
│   ├── base-resume.md      # canonical resume in Markdown (source of truth for tailoring)
│   └── original.pdf        # the file the user gave you (optional)
├── preferences.md          # target roles, locations, salary floor, deal-breakers, portals to search
├── tracker.csv             # every job seen: managed with scripts/tracker.py
├── searches/
│   └── 2026-11-06-linkedin-ml-engineer.md   # one log per search run
└── jobs/
    └── acme-robotics-senior-software-engineer-2026-11-06/
        ├── posting.md          # job description snapshot + URL
        ├── resume.md           # tailored resume (customize-resume)
        ├── resume.html / .pdf  # rendered
        ├── cover-letter.md     # optional
        └── application.md      # answers submitted, screenshots notes, confirmation
```

## profile.json

Same shape as `extension/src/shared/profile-schema.js`. Top-level sections are `personal`, `links`, `work`,
`education`, `authorization`, and `eeo`, plus `howDidYouHear`, `summary`, and `answers: [{ question, answer }]`.
EEO fields default to `"Decline to self-identify"`. A template is at `setup/assets/profile.template.json`.

Pay: `work.desiredSalary` is **annual** and `work.desiredHourlyRate` is **hourly**. Both are plain numbers, in
`work.salaryCurrency`. Autofill uses each only for fields worded that way. Pay fields that don't say hourly or annual,
or ask for monthly or daily pay, are always left for Claude to ask about. Nothing converts between the two.

**Reusable answers:** when the user answers a new custom question during job-apply (for example "Why are you leaving
your job?"), append it to `answers` if it's reusable. Then remind the user to re-import `profile.json` in the extension
options so autofill picks it up.

## tracker.csv

Columns: `id, found_at, portal, company, title, location, url, apply_url, fit, status, applied_at, folder, notes`.
`url` is where the job was found (LinkedIn, Jobright…). `apply_url` is the employer's application page. Lookups match
either one, so the same job seen on a board and on the employer's site is tracked once.

Statuses: `found` → `shortlisted` → `tailored` → `applying` → `applied`. Side branches are `skipped` (the user said no or
it's a poor fit), `blocked` (login or CAPTCHA failure, or the page broke), and `closed` (the posting is gone). Later
stages are `interview`, `offer`, and `rejected`.

Always go through the script so de-duplication and IDs stay consistent:

```bash
python3 <skill-dir>/references/shared/scripts/tracker.py add --portal linkedin --company "Acme" --title "ML Engineer" --url "https://..." --location "Remote" --fit High
python3 <skill-dir>/references/shared/scripts/tracker.py exists --url "https://..."     # exit 0 if already tracked
python3 <skill-dir>/references/shared/scripts/tracker.py update --id 12 --status applied --folder jobs/acme-...
python3 <skill-dir>/references/shared/scripts/tracker.py list --status shortlisted --limit 20
python3 <skill-dir>/references/shared/scripts/tracker.py init                          # create directory skeleton
```

## Folder names

`<company-slug>-<title-slug>-<YYYY-MM-DD>`: lowercase, alphanumerics and hyphens, 80 characters max.
`tracker.py slug --company X --title Y` prints one.
