# Greenhouse application

- **URL forms:** `job-boards.greenhouse.io/<board>/jobs/<id>`, `boards.greenhouse.io/<board>/jobs/<id>`, and company
  sites with `?gh_jid=<id>` (iframe `#grnhse_iframe`).
- **Login:** none. **Pages:** a single page with the form below the description (or the iframe).

## Flow
1. `detect()`. On a company-site embed, `applicationFrame` is the Greenhouse iframe. The bridge reaches it
   automatically. If you want to work in the frame directly, open its URL
   `https://job-boards.greenhouse.io/embed/job_app?for=<board>&token=<id>` in your tab.
2. Click "Apply" if the form is collapsed (newer boards show the form after an "Apply" button).
3. `autofill()` fills the name, email, phone, resume (stored or attached), LinkedIn, website, and standard
   yes/no selects.
4. Things that usually land in `needsInput`:
   - **Location (City)**: an autocomplete combobox. Click it, type the city, wait about 1 s, then click the first
     matching suggestion.
   - **react-select dropdowns** (newer boards, `combobox: true`): click the control, type the suggested value, then
     press Enter or click the option.
   - Custom questions (text or textarea): draft them per `references/answering-questions.md`.
   - **Demographic questions** are often react-selects too. Choose the "Decline" option.
5. Resume: if both "Attach" and "Enter manually" exist, attach. If `attachFile` fails, the user can drag in the file.
6. Submit: "Submit application" at the bottom. Success shows "Thank you for applying" or a `/confirmation` URL.

## Gotchas
- Some boards use an "Autofill with MyGreenhouse" prompt. Ignore it or close it.
- reCAPTCHA (invisible) may challenge on submit. If an image challenge appears, the user solves it.
