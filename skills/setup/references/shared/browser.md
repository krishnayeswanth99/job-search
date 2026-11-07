<!-- Generated from shared/browser.md by scripts/sync-shared.mjs. Edit the source, not this copy. -->
# Browser: Claude in Chrome + Job Copilot

All browsing goes through the **Claude in Chrome** MCP tools (`mcp__claude-in-chrome__*`), which act in the user's
real Chrome, so their sign-ins work. The **Job Copilot** extension from this repo (`extension/`) adds a page API,
`window.jobCopilot`, that you call with `javascript_tool`. Use it first. It is faster and more reliable than reading the
DOM yourself, and it never returns the user's profile data.

## Tab hygiene

1. `tabs_context_mcp`: see which tabs are open. If the user says "this tab" or "current", use their active tab.
2. Otherwise, open your own tab with `tabs_create_mcp` and `navigate` there. Don't take over tabs the user is using.
3. After `navigate` or a click that loads a page, wait 1–2 s (or use `computer` → `wait`) before you read the page.

## Is Job Copilot installed?

```js
window.jobCopilot ? { installed: window.jobCopilot.installed, enabled: window.jobCopilot.enabled, version: window.jobCopilot.version } : null
```

- `null`: the extension is not installed, or the tab was open before it was installed. Reload the tab once. If it's still
  `null`, use the **fallbacks** below and suggest that the user install it (`extension/README.md`).
- `enabled: false`: the user turned the bridge off in the extension options. Use the fallbacks.

## Page API

Each call returns a Promise and also stores its result in `window.jobCopilot.last`.

| Call | Returns |
|---|---|
| `await jobCopilot.detect()` | `{ portal, pageType: listings\|job\|application\|redirect\|unknown, jobCount, application, applicationFrame?, login: { required, kind, providers[], hints[] }, apply?, redirect?: { target }, interstitial?: { text, button, selector }, appliedPrompt?: { text, yes, no, yesSelector, noSelector }, openedTabs?: [{ url, title }] }` |
| `await jobCopilot.extractJobs({ limit })` | `{ count, jobs: [{ title, company, location, url, jobId, salary, postedAt, easyApply, remote, source }] }` |
| `await jobCopilot.extractJob()` | `{ job: { title, company, location, salary, description (≤15k chars), url, apply: { text, kind: easy-apply\|external\|onsite, target, newTab, selector } } }` |
| `await jobCopilot.followApply()` | Moves **this tab** to the real application when the link is known: unwraps redirect URLs, continues through "You're leaving…" screens. `{ ok: false, reason }` means the button is scripted or Easy Apply, so click it instead |
| `await jobCopilot.scanForm()` | `{ fields: [{ selector, label, type, required, hasValue, profileKey?, options?, combobox?, frame }] }` |
| `await jobCopilot.autofill({ overrides, overwrite })` | `{ filledCount, filled[], skipped[], needsInput: [{ selector, label, type, options?, reason, suggested? }] }` |
| `await jobCopilot.fillField({ selector \| label, value, check })` | `{ ok }`: sets a value so React, Vue, and Angular see the change. Works inside iframes. |
| `await jobCopilot.attachFile({ kind: 'resume'\|'coverLetter', url? })` | `{ ok }`: attaches the stored file, or fetches `url` (localhost only) and attaches it |

Notes:
- `overrides` maps a field's `selector`, exact `label`, or `profileKey` to a value. Use it to fill everything in one call
  after you've drafted answers.
- `autofill` and `attachFile` from the bridge only work on trusted job sites (the built-in list of ATS domains plus the
  user's additions). Anywhere else, ask the user to click **Autofill this application** in the extension popup.
- Application forms inside iframes (for example, Greenhouse embeds on company sites) are handled automatically. A
  `frame` value other than `"top"` means the field is in an iframe. Use `fillField`, not `form_input`, for those.
- Nothing ever submits. Custom dropdowns (`combobox: true`) need real clicks: click the control with `computer`, type the
  suggested value, then pick the option.

**If `javascript_tool` returns `{}` or a pending Promise** (the tool didn't await it), call without `await`, then read the
result in a second call:

```js
window.jobCopilot.extractJobs(); 'started'
```
```js
JSON.stringify(window.jobCopilot.last)
```

## Context safety

- **Never use `get_page_text` on search result pages** (LinkedIn, Indeed, Glassdoor and so on). They are huge and fill
  your context. Use `extractJobs()` or a targeted `javascript_tool` snippet.
- `get_page_text` is fine on a single job posting when `extractJob()` is unavailable.
- Use `read_page` with `filter: "interactive"` to find buttons and inputs, and `find` to locate one element in plain
  language.
- Truncate anything you pull with JS, for example `.slice(0, 50)`.

## Fallbacks without Job Copilot

Generic job list (works on most sites with JSON-LD or job links):

```js
(() => {
  const ld = [...document.querySelectorAll('script[type="application/ld+json"]')].flatMap(s => { try { const j = JSON.parse(s.textContent); return [].concat(j['@graph'] || j); } catch { return []; } }).filter(n => n['@type'] === 'JobPosting');
  if (ld.length) return ld.slice(0, 50).map(n => ({ title: n.title, company: n.hiringOrganization?.name, url: n.url, location: JSON.stringify(n.jobLocation?.address || '') }));
  return [...document.querySelectorAll('a[href]')].filter(a => /\/(jobs?|careers?|positions?|openings?)\/[^?#]*\w{3,}/i.test(a.href) && a.innerText.trim().length > 3 && a.innerText.trim().length < 140)
    .slice(0, 50).map(a => ({ title: a.innerText.trim().split('\n')[0], url: a.href }));
})()
```

Each portal playbook (`job-search/portals/*.md`) has a portal-specific fallback snippet. For forms, use `read_page`
(interactive) plus `form_input`. For React inputs that don't take `form_input`, click the field with `computer` and type.

## When the browser misbehaves

- If a tool errors with "no browser" or "extension not connected", ask the user to open Chrome and check that the Claude
  extension is signed in and connected. Then retry once.
- Don't retry a failing page more than twice. Record it as `blocked` in the tracker and move on.
- If there's a CAPTCHA or bot check, stop and ask the user to solve it in the tab.
