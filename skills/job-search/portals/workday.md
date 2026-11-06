# Workday playbook

**Hosts:** `<tenant>.wd1|wd3|wd5|wd12.myworkdayjobs.com/<locale>/<site>`, e.g.
`https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite` · **Extractor:** `workday` · **Login:** not needed
to search. Applying needs an account **per company**.

## Finding sites

The company's "Careers" page links to its Workday site. Or use WebSearch with `site:myworkdayjobs.com "<company>"` or
`site:myworkdayjobs.com "<title>"`.

## Search

On the site, use the search box (`[data-automation-id="keywordSearchInput"]`), or the URL: `…/<site>?q=<query>`.
Location filters are facets in the left panel. Click them, then extract.

## Fastest path: the CXS JSON endpoint (same origin; run it in the Workday tab with `javascript_tool`)

```js
(async () => { const [, tenant] = location.hostname.match(/^([^.]+)\./); const site = location.pathname.split('/').filter(Boolean).find(s => !/^[a-z]{2}-[A-Z]{2}$/.test(s));
  const r = await fetch(`/wday/cxs/${tenant}/${site}/jobs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText: 'QUERY' }) });
  const d = await r.json(); return { total: d.total, jobs: d.jobPostings.map(j => ({ title: j.title, location: j.locationsText, posted: j.postedOn, url: location.origin + '/' + location.pathname.split('/')[1] + '/' + site + j.externalPath })) }; })()
```

Paginate with `offset` (+20). The job detail JSON is `GET /wday/cxs/<tenant>/<site><externalPath>`.

## Browser extraction

- Results: `extractJobs()` reads `[data-automation-id="jobTitle"]` links, plus locations and posted date.
- Pagination: `button[aria-label="next"]` at the bottom.
- Job: `extractJob()` reads `[data-automation-id="jobPostingDescription"]`.
- **Apply** opens a choice: "Autofill with Resume", "Apply Manually", or "Use My Last Application". After that, a
  sign-in or create-account step **always** comes up. See `job-apply/ats/workday.md`.
