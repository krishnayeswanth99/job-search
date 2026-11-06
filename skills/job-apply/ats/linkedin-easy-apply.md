# LinkedIn Easy Apply

- **Trigger:** the "Easy Apply" button on `linkedin.com/jobs/view/<id>` or in the search details pane.
- **Login:** required. **Pages:** a modal with 2–6 steps (Contact info → Resume → Additional questions → Review).

## Flow
1. Click **Easy Apply** (`find("Easy Apply button")`). The modal is `div.jobs-easy-apply-modal` / `[role="dialog"]`.
2. **Contact info:** the email is a dropdown of the user's LinkedIn emails, and the phone country code and number are
   prefilled from LinkedIn. Run `autofill()` for anything that's empty.
3. **Resume:** LinkedIn shows previously uploaded resumes as cards. If the tailored PDF is there, select it. Otherwise
   click "Upload resume". `attachFile({ kind: 'resume', url: … })` works on the hidden `input[type=file]`. Then make sure
   the new card is selected.
4. **Additional questions:** typical ones are years of experience with X (numeric text, so give a whole number),
   yes/no radios, and selects. Run `autofill()` first, then draft the rest. LinkedIn **remembers** answers from earlier
   applications and prefills them, so check that the prefilled ones still fit.
5. Click **Next** or **Review** (`find("Next button in Easy Apply dialog")`). Never click **Submit application** until
   the user confirms.
6. **Review:** uncheck "Follow <company>" unless the user wants it. Screenshot, confirm, submit.
7. Success: "Your application was sent". Close the dialog ("Done" or ×).

## Gotchas
- Error text appears under fields (`.artdeco-inline-feedback--error`). Fix it and press Next again.
- If you close the modal mid-way, LinkedIn asks "Save this application?". Choose **Save** so nothing is lost.
- Keep the pace human-like: 1–2 s between steps.
