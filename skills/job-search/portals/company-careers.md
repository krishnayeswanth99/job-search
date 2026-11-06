# Company careers page playbook (generic)

For any employer site, such as `acme.com/careers`.

## Steps

1. Find the careers page: try `https://<domain>/careers` and `/jobs`. Otherwise use WebSearch with `"<company>" careers`.
2. `detect()` and `extractJobs()`. The generic extractor reads JSON-LD `JobPosting` data first, then job-like links.
3. **Identify the ATS behind it.** Most careers pages are thin wrappers. Check for these links or iframes:
   ```js
   [...new Set([...document.querySelectorAll('a[href], iframe[src]')].map(e => e.href || e.src).filter(u => /greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|smartrecruiters\.com|icims\.com|jobvite\.com|workable\.com|bamboohr\.com|recruitee\.com|teamtailor\.com/.test(u)).map(u => new URL(u).origin + new URL(u).pathname.split('/').slice(0, 3).join('/')))].slice(0, 10)
   ```
   If you find one, switch to that portal's playbook. Its JSON API is far more reliable than scraping the wrapper page.
4. If the page renders jobs with JavaScript and there's no ATS link, scroll, wait, and extract again. As a last resort,
   use `read_page` with `filter: "interactive"` to list the links.

## Common ATS JSON endpoints

| ATS | Endpoint |
|---|---|
| Greenhouse | `https://boards-api.greenhouse.io/v1/boards/<board>/jobs?content=true` |
| Lever | `https://api.lever.co/v0/postings/<company>?mode=json` |
| Ashby | `https://api.ashbyhq.com/posting-api/job-board/<company>` |
| SmartRecruiters | `https://api.smartrecruiters.com/v1/companies/<company>/postings` |
| Workable | `https://apply.workable.com/api/v1/widget/accounts/<company>` |
| Recruitee | `https://<company>.recruitee.com/api/offers/` |
