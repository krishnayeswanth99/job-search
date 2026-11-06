# Greenhouse playbook

**Hosts:** `boards.greenhouse.io/<board>`, `job-boards.greenhouse.io/<board>`, and embeds on company sites
(`?gh_jid=<id>`, `#grnhse_app`) · **Extractor:** `greenhouse` · **Login:** never needed.

## Finding boards

Greenhouse has no cross-company search. Two ways in:
1. **Known companies:** look for `https://job-boards.greenhouse.io/<company>`. The slug is usually the company name
   without spaces.
2. **Discovery:** use WebSearch with `site:job-boards.greenhouse.io OR site:boards.greenhouse.io "<title>" "<location or remote>"`.

## Fastest path: the public JSON API (no browser needed)

```bash
curl -s "https://boards-api.greenhouse.io/v1/boards/<board>/jobs?content=true" | python3 -c "import json,sys; d=json.load(sys.stdin); [print(j['id'], '|', j['title'], '|', j['location']['name'], '|', j['absolute_url']) for j in d['jobs']]"
```

`content=true` includes the HTML description. Filter by title in Python before reading descriptions. Use the browser
when the API is blocked or the user wants to look at the page.

## Browser extraction

- Board page: `extractJobs()` reads `tr.job-post` / `.opening` rows.
- Job page: `extractJob()`. JSON-LD gives the company, salary, and date. The application form is usually **on the same
  page**, below the description.
- On a company-site embed, the form is in an iframe (`#grnhse_iframe`). `detect()` reports `applicationFrame`.

**Fallback snippet:**

```js
[...document.querySelectorAll('tr.job-post a, .opening a')].slice(0, 100).map(a => ({ title: (a.querySelector('p') || a).innerText.trim(), location: a.closest('tr, .opening')?.querySelector('.location, p.body__secondary')?.innerText.trim(), url: a.href }))
```
