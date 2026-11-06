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
- **iCIMS:** the form is inside the iframe `#icims_content_iframe`. There's an email-first login, then a resume-parse
  step, then the form. Always review the parsed values.
- **SmartRecruiters:** a single page with a "Confirm your email" step. Its "Autofill with LinkedIn" button needs the user.
- **Workable:** a single page. The resume parses into the fields. Questions are under "Details".
- **Taleo / SuccessFactors:** long multi-page forms that time out quickly. Save often ("Save as Draft").
- **Trusted sites:** if `autofill()` is refused because the domain isn't trusted (a custom company domain), ask the user
  to click **Autofill** in the Job Copilot popup, or to add the domain under Trusted sites in the options.
