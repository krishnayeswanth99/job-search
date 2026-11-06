# Wellfound (AngelList Talent) playbook

**Host:** `wellfound.com` · **Extractor:** `wellfound` · **Login:** required for the full job list and for applying.

## Search URLs

- By role: `https://wellfound.com/role/r/<role-slug>`, e.g. `software-engineer`, `machine-learning-engineer`
- By role and location: `https://wellfound.com/role/l/<role-slug>/<location-slug>`, e.g. `/role/l/software-engineer/san-francisco`
- Remote: `https://wellfound.com/remote`
- Signed-in job feed with filters: `https://wellfound.com/jobs`

## Extraction

1. `detect()`. If `login.required` comes back, ask the user to sign in (Google, email, or LinkedIn).
2. `extractJobs()` finds `/jobs/<id>-<slug>` links grouped by startup card. Company, salary, and equity are usually in
   the card.
3. Pagination is infinite scroll. Scroll the window (`computer` → `scroll`) 3–5 times, then extract again.

## Job details

The job page has the description, the salary and equity range, and an **Apply** button that opens an on-site modal with
a short note field. job-apply should use the profile's `summary` plus a tailored 2–3 sentence note. Wellfound doesn't
usually use an external ATS.
