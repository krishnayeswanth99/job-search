# Workday application

- **URL:** `<tenant>.wdN.myworkdayjobs.com/<locale>/<site>/job/<...>/apply`
- **Login:** **always**, with one account per company tenant. **Pages:** 5–7 steps (My Information → My Experience →
  Application Questions → Voluntary Disclosures → Self Identify → Review).

## Flow
1. Click **Apply**. Choose **Apply Manually**. "Autofill with Resume" parses badly and creates cleanup work. Use "Use My
   Last Application" if it's offered and the user has applied to this company before.
2. **Sign in / Create Account** (`detect().login.kind`). Hand it to the user (`references/login-and-signup.md`). Workday
   may email a verification link.
3. **My Information:** "How did you hear about us?" is a multi-level prompt picker. Click it, choose a category (for
   example "Job Board" or "Social Media"), then the source. Previous worker → "No". Then the name, address, email, and
   phone (Phone Device Type is a dropdown: pick "Mobile"). Country and state are prompt pickers too.
4. **My Experience:** work history and education are repeatable sections ("Add" buttons). Fill them from the resume,
   newest first, with the most recent 2–3 roles at most unless the form requires more. Dates are split month and year
   fields. Upload the resume in the "Resume/CV" drop zone (`attachFile`). Skills is a type-ahead multi-select: add 5–10
   skills that match the posting.
5. **Application Questions:** yes/no dropdowns and text. Draft them per `references/answering-questions.md`.
6. **Voluntary Disclosures / Self Identify:** use the EEO profile values. Self-identify asks for the name and date
   (today), plus the disability status per the profile. The default is "I do not want to answer".
7. **Review:** screenshot it, confirm with the user, then **Submit**.

## Technique
- Workday inputs carry `data-automation-id` attributes, which the extension uses for matching. Dropdowns are
  `button[aria-haspopup="listbox"]`: click, then click the `[role="option"]` whose text matches.
- Prompt pickers (`[data-automation-id="multiselectInputContainer"]`): click, type, wait, then click the matching
  `[data-automation-id="promptOption"]`.
- After each **Save and Continue**, run `detect()`, then `autofill()` again. Validation errors appear at the top as
  `[data-automation-id="errorMessage"]`.
- Sessions time out after about 20–30 minutes of inactivity. Keep moving, or save as a draft and tell the user.
