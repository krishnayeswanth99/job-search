# Lever application

- **URL:** `jobs.lever.co/<company>/<uuid>/apply` (click "Apply for this job" on the posting).
- **Login:** none. **Pages:** a single page.

## Flow
1. Open `…/apply` directly, or click the apply button.
2. **Resume first.** Lever parses the uploaded resume and pre-fills the name, email, phone, and company. Attach the
   resume first (`attachFile`, or let `autofill()` do it), wait 2–3 s for parsing, then run
   `autofill({ overwrite: false })` so the profile values fill whatever is still empty.
3. Fields: "Full name" (one field), email, phone, current company, links (LinkedIn, GitHub, Portfolio, Other), and
   "Additional information" (a free-text cover note, which is optional, so draft 3–4 lines or leave it blank per
   preferences).
4. Custom cards (`.application-question`): radios, checkboxes, and textareas. `scanForm` groups radios with their
   options.
5. EEO section (US): selects. Choose "Decline to self-identify".
6. Submit: "Submit application". Success page: "Application submitted!" or a `/thanks` URL.

## Gotchas
- hCaptcha can show up on submit. The user solves it.
- Location fields sometimes use an autocomplete. Type the city, then pick from the list.
