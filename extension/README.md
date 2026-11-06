# Job Copilot (Chrome extension)

Manifest V3, plain JavaScript, no build step.

## Install (unpacked)
1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select this `extension/` folder.
3. In the options page that opens: import `~/.job-search/profile.json` (or type your profile in), choose your resume
   PDF, and optionally a cover letter.
4. Reload any tabs that were already open. Content scripts load on page load.

## What it does

| Feature | How |
|---|---|
| Badge on the toolbar icon | The job count on listing pages, `JOB` on a posting, `FILL` on an application form, `LOG` when a login is required |
| **Find jobs on this tab** | Portal extractors (LinkedIn, Indeed, Glassdoor, Wellfound, Greenhouse, Lever, Ashby, Workday), then JSON-LD `JobPosting`, then generic job-link scanning. You can save jobs and export them as JSON or CSV. |
| **Read this job posting** | Title, company, location, salary, description, and apply button (DOM merged with JSON-LD) |
| **Autofill this application** | Classifies every field (label, name, id, autocomplete, Workday `data-automation-id`), fills it from your profile and saved answers, picks select, radio, and checkbox options (yes/no, decline-to-answer, country aliases, numeric ranges), attaches your resume, and works inside iframes. It **never submits** and never ticks consent boxes. |
| Login detection | Password fields, LinkedIn auth wall, Workday sign-in or create-account, Indeed secure login, sign-in dialogs, SSO providers |
| Claude bridge | `window.jobCopilot` for Claude in Chrome (below) |

## Claude bridge API

`src/page/page-api.js` defines `window.jobCopilot` in the page. Claude in Chrome's `javascript_tool` calls it.

```js
await jobCopilot.detect()          // { portal, pageType, jobCount, application, applicationFrame?, login }
await jobCopilot.extractJobs()     // { count, jobs: [...] }
await jobCopilot.extractJob()      // { job: { title, company, description, apply, ... } }
await jobCopilot.scanForm()        // { fields: [{ selector, label, type, required, hasValue, profileKey, options }] }
await jobCopilot.autofill({ overrides: { '[data-jc-ref="jc-ab12-7"]': 'answer' }, overwrite: false })
await jobCopilot.fillField({ selector, value })   // or { label, value } / { selector, check: true }
await jobCopilot.attachFile({ kind: 'resume', url: 'http://127.0.0.1:8765/Ada-Resume-Acme.pdf' })
jobCopilot.last                    // the last result, for tools that don't await promises
```

Full reference for skill authors: [`../shared/browser.md`](../shared/browser.md).

## Security model

- **The bridge never returns profile data.** `scanForm` and `autofill` report labels, selectors, and which profile key
  matched, never the values.
- **Write commands (`autofill`, `attachFile`) only run through the bridge on trusted job domains:** the built-in ATS and
  portal list (`src/shared/config.js`) plus domains you add in the options. Each frame checks its own hostname, so a
  Greenhouse iframe embedded in a company site works, and an untrusted page can't trigger autofill and read the
  results. On any other site, clicking **Autofill** in the popup (a user action) still works.
- The command's origin (`bridge` or `popup`) is set by the service worker from the message sender. A page can't forge it.
- `attachFile({ url })` only fetches from `127.0.0.1` or `localhost`, and only files of 10 MB or less.
- The bridge can be turned off entirely in the options ("Enable the Claude bridge"), and so can bridge-triggered
  autofill on its own.
- Everything (profile, files, saved jobs) stays in `chrome.storage.local`. Nothing is sent anywhere.

### Permissions
- `<all_urls>` host access and content scripts: needed to detect jobs and autofill on any company careers site.
  The scripts are idle until asked, apart from a light status check for the badge.
- `scripting`: runs commands in every frame of the tab (application forms often live in iframes).
- `storage` and `unlimitedStorage`: the profile and resume file.

## Files

```
manifest.json
src/shared/config.js          portals, trusted domains, default settings
src/shared/profile-schema.js  profile shape (shared with ~/.job-search/profile.json)
src/shared/field-rules.js     field classification + option matching (pure, unit-tested)
src/content/util.js           DOM helpers
src/content/jsonld.js         schema.org JobPosting reader
src/content/login.js          login / signup wall detection
src/content/extractors.js     per-portal extractors + generic fallback
src/content/fields.js         form discovery, labels, data-jc-ref selectors
src/content/autofill.js       value setting (framework-safe), file attach
src/content/main.js           command handler, page bridge relay, badge
src/page/page-api.js          window.jobCopilot (MAIN world)
src/background.js             multi-frame runner, local file fetch, badge
popup/ options/               UI
```

## Testing
From the repo root, run `npm run test:unit` and `npm run test:e2e`. The e2e run loads this extension into Chromium
against fixture pages served at real portal hostnames, and checks extraction, autofill, iframes, the trust rules, and
login detection.
