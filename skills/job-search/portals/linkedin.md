# LinkedIn playbook

**Host:** `www.linkedin.com` · **Extractor:** `linkedin` · **Login:** recommended. Guests see fewer results, and an auth
wall appears after a few pages.

## Search URL

```
https://www.linkedin.com/jobs/search/?keywords=<q>&location=<loc>&f_TPR=r604800&sortBy=R
```

| Param | Values |
|---|---|
| `keywords` | URL-encoded query. Boolean works: `"machine learning" AND (python OR pytorch) NOT intern` |
| `location` | `United States`, `Bengaluru, Karnataka, India`, `Remote` |
| `geoId` | Optional, more precise than `location` (`103644278` = United States, `102713980` = India) |
| `f_TPR` | Posted within: `r86400` (24 h), `r604800` (week), `r2592000` (month) |
| `f_WT` | Work type: `1` onsite, `2` remote, `3` hybrid (comma-separated, e.g. `2,3`) |
| `f_E` | Experience: `1` intern, `2` entry, `3` associate, `4` mid-senior, `5` director, `6` executive |
| `f_JT` | Job type: `F` full-time, `C` contract, `P` part-time, `I` internship |
| `f_AL` | `true` = Easy Apply only |
| `sortBy` | `R` relevance, `DD` most recent |
| `start` | Pagination offset: `0, 25, 50, …` |

## Extraction

1. `detect()`. LinkedIn sometimes shows the **auth wall** (`/authwall`, or a "Sign in to view more jobs" modal). Ask the
   user to sign in, then reload the search URL.
2. The results list is lazy-loaded and virtualized. Use `loadMoreJobs({ rounds: 4 })`, which scrolls the results pane and
   keeps cards LinkedIn removes. Without the extension, scroll the **results pane**, not the window:
   ```js
   (async () => { const pane = document.querySelector('.scaffold-layout__list > div, .jobs-search-results-list'); for (let i = 0; i < 8 && pane; i++) { pane.scrollBy(0, 800); await new Promise(r => setTimeout(r, 300)); } return document.querySelectorAll('li[data-occludable-job-id]').length; })()
   ```
3. `extractJobs()` returns `easyApply` and canonical `https://www.linkedin.com/jobs/view/<id>/` URLs.
4. Pagination: change `start=` in the URL (+25). Stop when a page returns no new IDs.

**Fallback snippet** (no extension):

```js
[...document.querySelectorAll('li[data-occludable-job-id]')].slice(0, 50).map(li => ({ id: li.dataset.occludableJobId, title: li.querySelector('.job-card-list__title--link strong, .job-card-list__title')?.innerText.trim(), company: li.querySelector('.artdeco-entity-lockup__subtitle')?.innerText.trim(), location: li.querySelector('.job-card-container__metadata-wrapper li')?.innerText.trim(), easyApply: /Easy Apply/.test(li.innerText), url: `https://www.linkedin.com/jobs/view/${li.dataset.occludableJobId}/` }))
```

## Job details

Clicking a card opens the details pane on the right without leaving the page. That's faster, and LinkedIn sees fewer
page loads. Then run `extractJob()`. It reads the pane, including the current `currentJobId`.

The **Apply** button is either "Easy Apply" (an on-site multi-step modal, see `job-apply/ats/linkedin-easy-apply.md`) or
"Apply". "Apply" opens the company's site in a new tab, and `extractJob().apply.kind` is `'external'`. LinkedIn's button
is scripted, so the destination URL is usually only known after clicking: `detect().openedTabs` then shows it. When you
return, LinkedIn may ask "Did you apply?" (see `job-apply/references/boards-and-redirects.md`).

## Etiquette

- LinkedIn is strict about automation. Keep runs small: 3 pages or fewer, 25 detail views or fewer, with pauses.
- Never send connection requests or messages, and never "follow" companies, unless the user asks.
