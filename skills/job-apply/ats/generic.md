# Generic / other ATS

Covers iCIMS, SmartRecruiters, Jobvite, Workable, BambooHR, Taleo, SuccessFactors, Recruitee, Teamtailor, and custom
forms.

## Flow
1. `detect()`. If there's a login or create-account wall, hand it to the user. iCIMS, Taleo, and SuccessFactors usually
   require an account.
2. If the form is in an iframe, the bridge handles it (`applicationFrame`). Without the extension, open the iframe's
   `src` in its own tab.
3. `autofill()`, then `scanForm()` to see what's left.
4. Fill the rest with `fillField({ selector, value })`. Use `computer` clicks for custom widgets.
5. Multi-page: Next or Continue, then `detect()` and `autofill()` again on each page.
6. Review → screenshot → confirm → submit → check for a confirmation.

## Site notes
- **iCIMS:** the form is inside the iframe `#icims_content_iframe`. The flow is an email-first login (the user's step,
  sometimes with hCaptcha), then a resume upload or parse step, then multi-page forms. Job Copilot autofills each new step
  by itself when the tab came from a job board. It picks custom dropdowns such as "How did you hear about us?" by
  clicking, sets a phone "Type" to Mobile, and leaves "Previous <company> Employee ID" empty. Always review the parsed
  values.
  - Job boards often hand out the embedded link (`?in_iframe=1`), where the form's buttons can be out of view. Job
    Copilot removes that parameter when opening the link, and `jobCopilot.nextStep()` clicks Next or Continue even if
    it's hidden. It never clicks Submit: it scrolls to Submit and outlines it.
  - Profile page fields: "Source" is the same as how you heard about the job, and "Please specify" is the specific site.
    "Time Zone" is taken from the browser's time zone.
  - "Candidate Sign-off on Information Provided", where you type your name, is an attestation. Leave it to the user.
- **SmartRecruiters:** a single page with a "Confirm your email" step. Its "Autofill with LinkedIn" button needs the user.
- **Workable:** a single page. The resume parses into the fields. Questions are under "Details".
- **Taleo / SuccessFactors:** long multi-page forms that time out quickly. Save often ("Save as Draft").
  After a Google or LinkedIn sign-in, Taleo returns to `application.jss?...&scope=...googleapis.com/auth/...`: that is
  the application, not a login page (Job Copilot only reads the address's path for login words).
  Its **Resume Upload Selection** step ("Use my LinkedIn profile / Upload a resume / No thanks, I will fill out the
  online submission manually", then "Select the resume file to upload") is answered by `autofill()`: Upload a resume,
  My computer, then the stored resume is attached. Taleo may then need its own **Upload** button clicked.
- **Single-page ATSs (Taleo, SuccessFactors, Oracle, Workday steps):** questions change without a new page load. In a
  tab opened from a job board, Job Copilot notices a new set of questions and autofills them; elsewhere run
  `autofill()` again after each step.
- **Trusted sites:** if `autofill()` is refused because the domain isn't trusted (a custom company domain), ask the user
  to click **Autofill** in the Job Copilot popup, or to add the domain under Trusted sites in the options.

## Apply buttons on the employer's own page
- `followApply()` (popup **Go to application**) on an employer job page clicks its Apply and follows whatever comes:
  a form on the same page, a pop-up of ways to apply ("Apply manually", "Continue as guest", "Apply with resume";
  never LinkedIn/Indeed/Google imports), a new page, or a sign-in wall (left to the user).
- When **you** click Apply on an employer page yourself, the tab becomes an application tab: the same choices are
  taken, and each step is autofilled as it appears. A tab the site opens right after (an ATS in a new tab) counts too.

## Forms without linked labels (Gem, custom career sites)
- Label text that sits above the box with no `<label for>`, id, name or aria-label is used as the label (the nearest
  short text before the field's wrapper).
- Radio buttons without a `name` are grouped by the wrapper they share, and the question above them is the label.
- An unlabelled upload box that takes PDF/Word files is the resume when the form has no other resume upload.
- The form's own submit button (for example "Apply" at the bottom) is never taken for "start the application".

