# Answering application questions

Sources, in priority order: what the user said this session → `profile.json` (`answers` included) → the tailored
`resume.md` or `base-resume.md` → `posting.md` (for "why us" context). If none of these covers it, **ask**.

## Standard questions

| Question pattern | Answer from |
|---|---|
| Authorized to work in <country>? | `authorization.authorizedToWork`. If the job country differs from the one the profile covers, ask. |
| Require sponsorship (now or future)? | `authorization.requiresSponsorship` |
| Willing to relocate / work onsite N days? | `willingToRelocate`, `remotePreference`. If it's ambiguous, ask. |
| Years of experience with <skill> | Count from the dated roles in the resume where the skill appears. Round down. If the skill isn't in the resume, ask. |
| Desired salary / expected CTC (annual) | `work.desiredSalary` (annual, plain number). If it's blank, ask. If the field is optional, leave it blank. Never invent a number. |
| Hourly / contract rate | `work.desiredHourlyRate`. If it's blank, ask. **Never convert** between hourly and annual (2080 hours, overtime and benefits make it the user's call). |
| Pay question that doesn't say the period, or asks monthly or daily | Autofill leaves it in `needsInput` with `payPeriod` (`unknown`, `monthly`, `daily`). Check the posting: a salaried role means annual, a contract or hourly role means hourly. If it's still unclear, ask the user. Never convert. |
| Current / previous salary | Leave blank or "Prefer not to say" where that's allowed. Some places ban asking. Ask the user only if the field is required. |
| Notice period / start date | `noticePeriod`, `earliestStartDate` |
| How did you hear about us? | The portal you came from (LinkedIn, Indeed…), or `howDidYouHear` |
| Referred by an employee? | "No", unless the user said otherwise |
| Previously worked here? | Check the resume. If the company isn't there, "No". |
| Non-compete / restrictive agreements? | Ask |
| Criminal history / background check consent | Ask. Never answer this yourself. |
| EEO (gender, race, veteran, disability) | `eeo.*`, which defaults to "Decline to self-identify" |
| Pronouns, preferred name | `personal.pronouns`, `personal.preferredName`, or blank |

## Free-text questions

- "Why do you want to work here?" / "Why this role?" (80–150 words): one specific thing about the company or product from
  the posting, plus two pieces of matching evidence from the resume, plus what you'd contribute.
- "Tell us about yourself" / "Summary": the profile `summary` adapted to the role.
- "Describe a project / achievement": pick the most relevant bullet and expand it with situation → action → result,
  using only facts from the resume. If you need more detail than the resume has, ask.
- Anything that asks for a link (portfolio, GitHub, writing sample): use `links.*` or ask.
- Respect character limits. Check `maxlength` on the field (via `scanForm` labels or `read_page`).

Style: first person, plain, specific, and confident. No clichés, no em dashes, no "As an AI".

## Reuse

If a free-text answer is generic enough to reuse (for example "Why are you looking for a new role?"), add it to
`profile.json` → `answers` after the user approves it. Company-specific answers belong only in
`<folder>/application.md`.
