# Glassdoor playbook

**Hosts:** `www.glassdoor.com` (plus `.co.uk`, `.co.in`, `.ca`) · **Extractor:** `glassdoor` · **Login:** a sign-up modal
usually appears after a few interactions.

## Search URL

```
https://www.glassdoor.com/Job/jobs.htm?sc.keyword=<q>&locKeyword=<loc>&fromAge=7&sortBy=date_desc
```

Other filters (`remoteWorkType=1` for remote, `minSalary=`, `jobType=fulltime`) can be added from the filter bar. Click
the filter, then read the resulting URL.

## Extraction

1. `detect()`. If a "Sign in / create account" modal blocks the list (`login.required`), ask the user to sign in or close
   it. Never close it by entering details yourself.
2. `extractJobs()` reads `[data-test="jobListing"]` cards.
3. Pagination is a **"Show more jobs"** button: `find("Show more jobs button")`, click it, wait 2 s, then extract again.
   Do this at most 3 times.

**Fallback snippet:**

```js
[...document.querySelectorAll('[data-test="jobListing"]')].slice(0, 50).map(c => ({ title: c.querySelector('[data-test="job-title"]')?.innerText, company: c.querySelector('[class*="EmployerProfile_compactEmployerName"]')?.innerText, location: c.querySelector('[data-test="emp-location"]')?.innerText, salary: c.querySelector('[data-test="detailSalary"]')?.innerText, url: c.querySelector('a[data-test="job-title"]')?.href }))
```

## Job details

Clicking a card loads the details pane. Run `extractJob()`. Glassdoor's "Easy Apply" is its own flow. Otherwise "Apply on
employer site" leads to an external ATS. Company ratings, if shown, can go in the notes.
