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

## With Job Copilot
- `jobCopilot.startApplication()` on the job page clicks **Apply** and chooses "Use My Last Application" or "Apply
  Manually". It stops at sign-in or create-account, which is the user's step. Tabs opened from a job board do this by
  themselves.
- After sign-in, each step (My Information, My Experience, Application Questions…) is autofilled as it loads, including
  Workday's button dropdowns (Phone Device Type, Country, State, yes/no questions), which it opens and picks from.
- Self Identify's signature **Date** (Month / Day / Year spin boxes) gets today's date, typed in key by key because
  Workday ignores pasted values. Other split dates (birth date, start date) are left for the user.
- Prompt pickers that already show a choice (a pill such as "United Kingdom (+44)") are left as they are.
- Multi-level "How Did You Hear About Us?" pickers: it types the profile's source (e.g. LinkedIn) to search all levels,
  otherwise opens each category looking for it, and only then takes "Other" or a close category. If no level matches,
  it's left outlined for the user.
- Name parts: Middle Name is filled only from the profile's middle name; Prefix, Suffix and local-script names are
  left alone.
- `jobCopilot.nextStep()` clicks **Save and Continue**. It never submits.

## Technique
- Workday inputs carry `data-automation-id` attributes, which the extension uses for matching. Dropdowns are
  `button[aria-haspopup="listbox"]`: click, then click the `[role="option"]` whose text matches.
- Prompt pickers (`[data-automation-id="multiselectInputContainer"]`): click, type, wait, then click the matching
  `[data-automation-id="promptOption"]`.
- After each **Save and Continue**, run `detect()`, then `autofill()` again. Validation errors appear at the top as
  `[data-automation-id="errorMessage"]`.
- Sessions time out after about 20–30 minutes of inactivity. Keep moving, or save as a draft and tell the user.
