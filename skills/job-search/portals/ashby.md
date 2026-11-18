# Ashby playbook

**Host:** `jobs.ashbyhq.com/<company>` · **Extractor:** `ashby` · **Login:** never needed.

## Finding boards

- Known company: `https://jobs.ashbyhq.com/<company>`
- Discovery: WebSearch with `site:jobs.ashbyhq.com "<title>" "<location or remote>"`

## Fastest path: the public JSON API

```bash
curl -s "https://api.ashbyhq.com/posting-api/job-board/<company>?includeCompensation=true" | python3 -c "import json,sys; [print(j['id'], '|', j['title'], '|', j.get('location'), '|', j.get('isRemote'), '|', j['jobUrl']) for j in json.load(sys.stdin)['jobs']]"
```

The response includes `descriptionPlain` and the compensation summary.

## Browser extraction

Ashby is a React SPA. Wait about 1.5 s after load.
- Board: `extractJobs()` finds job links by UUID.
- Job: `https://jobs.ashbyhq.com/<company>/<uuid>`. Run `extractJob()`. JSON-LD is usually present.
- Application: the **Application** tab (`…/<uuid>/application`), see `job-apply/ats/ashby.md`.
