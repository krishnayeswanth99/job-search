# Lever playbook

**Host:** `jobs.lever.co/<company>` (EU: `jobs.eu.lever.co`) · **Extractor:** `lever` · **Login:** never needed.

## Finding boards

- Known company: `https://jobs.lever.co/<company>`
- Discovery: WebSearch with `site:jobs.lever.co "<title>" "<location or remote>"`

Board filters go in the URL: `?location=Remote&team=Engineering&commitment=Full-time`.

## Fastest path: the public JSON API

```bash
curl -s "https://api.lever.co/v0/postings/<company>?mode=json" | python3 -c "import json,sys; [print(p['id'], '|', p['text'], '|', p['categories'].get('location'), '|', p['hostedUrl']) for p in json.load(sys.stdin)]"
```

Each posting includes `descriptionPlain`, `lists` (requirements), and `applyUrl`.

## Browser extraction

- Board: `extractJobs()` reads `.posting` rows (title, location, team, commitment).
- Posting: `https://jobs.lever.co/<company>/<uuid>`. Run `extractJob()`.
- Application: `…/<uuid>/apply`, a single-page form (see `job-apply/ats/lever.md`).

**Fallback snippet:**

```js
[...document.querySelectorAll('.posting')].slice(0, 100).map(p => ({ title: p.querySelector('[data-qa="posting-name"], h5')?.innerText, location: p.querySelector('.sort-by-location, .location')?.innerText, url: p.querySelector('a.posting-title')?.href }))
```
