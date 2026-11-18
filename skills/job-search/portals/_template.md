# <Portal name> playbook

**Hosts:** `<host>` · **Extractor:** `<id in extension/src/content/extractors.js, or "generic">` · **Login:** <never | to
search | to apply>

## Search URL

```
https://<host>/<path>?<query param>=<q>&<location param>=<loc>
```

| Param | Values |
|---|---|
| | |

## Extraction

1. `detect()`, then any portal-specific walls.
2. `extractJobs()`: what it returns here, plus any scrolling or waiting the page needs first.
3. Pagination: URL param or button, and when to stop.

**Fallback snippet** (no extension):

```js
// return an array of { title, company, location, url } from the results page, capped with .slice(0, 50)
```

## Job details

How to open a posting, where the description lives, and what the apply button leads to (on-site flow or external ATS).

## Etiquette / limits

Rate limits, bot checks, and anything never to do on this site.
