# Indeed playbook

**Hosts:** `www.indeed.com`, plus country sites (`in.indeed.com`, `uk.indeed.com`, `ca.indeed.com`, …) · **Extractor:**
`indeed` · **Login:** not needed to search. Needed for "Easily apply" (Indeed Apply).

## Search URL

```
https://www.indeed.com/jobs?q=<q>&l=<loc>&fromage=7&sort=date
```

| Param | Values |
|---|---|
| `q` | Query. Supports `title:(engineer)`, quotes, and `-exclude` |
| `l` | Location (`Remote` works) |
| `radius` | Miles: `0, 5, 10, 25, 50, 100` |
| `fromage` | Days since posted: `1, 3, 7, 14` |
| `sc` | Filters, e.g. remote: `0kf%3Aattr(DSQF7)%3B` |
| `salaryType` | e.g. `%24150%2C000` |
| `sort` | `date` or omit for relevance |
| `start` | Pagination: `0, 10, 20, …` |

Use the user's country site when their location is outside the US.

## Extraction

1. `detect()`. If there's a Cloudflare or "verify you are human" page, ask the user to complete it.
2. `extractJobs()` returns `jk` IDs and `…/viewjob?jk=<id>` URLs. `easyApply: true` means "Easily apply" (Indeed Apply).
3. Pagination: `start=` +10, or click `a[data-testid="pagination-page-next"]`. Stop after 3 pages or when you stop
   getting new jk values.

**Fallback snippet:**

```js
[...document.querySelectorAll('[data-jk]')].slice(0, 50).map(c => ({ jk: c.dataset.jk, title: c.querySelector('h2.jobTitle span[title]')?.title || c.querySelector('h2')?.innerText, company: c.closest('.job_seen_beacon')?.querySelector('[data-testid="company-name"]')?.innerText, location: c.closest('.job_seen_beacon')?.querySelector('[data-testid="text-location"]')?.innerText, url: location.origin + '/viewjob?jk=' + c.dataset.jk }))
```

## Job details

Open `…/viewjob?jk=<id>` and run `extractJob()`. The description is in `#jobDescriptionText`.
- `#indeedApplyButton` means Indeed Apply: an on-site flow at `smartapply.indeed.com` (see `job-apply/ats/indeed.md`).
- "Apply on company site" goes to an external ATS.
