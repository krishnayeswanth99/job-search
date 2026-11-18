# Job Copilot (Chrome extension)

Manifest V3, plain JavaScript, no build step.

## Install (unpacked)
1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select this `extension/` folder.
3. In the options page that opens, click **Upload resume**. Job Copilot reads your details from it and shows them for
   review: edit anything that's wrong, untick what you don't want, then **Save selected to profile**. Everything stays
   editable in the Profile section afterwards. (Or import `~/.job-search/profile.json` from the Claude setup skill.)
4. Reload any tabs that were already open. Content scripts load on page load.

## What it does

| Feature | How |
|---|---|
| **Read with Claude (optional)** | Add your own Anthropic API key under **Claude (optional)** and click **Read with Claude** (or turn on "use automatically"). The PDF goes to the Claude API as a document (DOCX/TXT as text) through the official Anthropic SDK, with a structured-output schema that only asks for resume facts (never work authorization, salary or EEO). Results land in the same review panel, tagged "from Claude". Default model: Claude Haiku 5.5; Sonnet 5.5 and Opus 5.5 are selectable. If the call fails, the built-in reader's results are shown instead. |
| **Profile from your resume** | Upload a PDF, DOCX or TXT resume in the options page. It's read locally (pdf.js for PDFs, a built-in zip reader for DOCX) and turned into suggested values: name, email, phone, location, links, current title and company, years of experience, education, skills and summary. You review each one, edit it, untick anything wrong, then save. Fields you already filled are never overwritten unless you tick them. |
| Badge on the toolbar icon | The job count on listing pages, `JOB` on a posting, `FILL` on an application form, `LOG` when a login is required |
| **Find jobs on this tab** | Portal extractors (LinkedIn, Indeed, Glassdoor, Wellfound, Greenhouse, Lever, Ashby, Workday), then JSON-LD `JobPosting`, then generic job-link scanning. You can save jobs and export them as JSON or CSV. |
| **Read this job posting** | Title, company, location, salary, description, and apply button (DOM merged with JSON-LD) |
| **Autofill this application** | Classifies every field (label, name, id, autocomplete, Workday `data-automation-id`), fills it from your profile and saved answers, picks select, radio, and checkbox options (yes/no, decline-to-answer, country aliases, numeric ranges), attaches your resume, and works inside iframes. It **never submits** and never ticks consent boxes. |
| **Answer memory** | When you (or Claude) answer a question autofill didn't know and click Submit or Next, the question and answer are saved under **Saved answers** (marked "remembered") and filled in automatically the next time the same question appears. Answers that mention a company, or questions like "Why do you want to work here?", are reused only for that company. Never remembered: profile fields, consent boxes, demographic and pay answers, files, passwords, or anything that looks like an email, phone, ID or card number. You can edit, re-scope or delete each one, or turn it off in the options. |
| **Apply links on aggregators** | On Jobright and similar sites, **Find apply links** clicks through each job's Apply and the "Apply Without Customizing" pop-up, catches the employer's address (Greenhouse, Lever, Workday…), closes the site's pop-ups unanswered, and saves the link. When you apply by hand, the link of the tab the site opens is saved for the job you clicked. Optional **real mouse clicks** (Chrome's debugger permission, which shows a bar while used) work on sites that ignore script clicks |
| **Apply one by one** | On a job board feed (Jobright), it opens each job's employer application in turn, through Apply and "Apply Without Customizing", autofilled. You review and submit. After the employer confirms, the tab closes and the next job opens. Closing a tab (or **Skip**) moves on, and **Stop** ends the run |
| **Questions left → Claude / ChatGPT (no API)** | On an application form, autofill outlines every question it couldn't answer in purple. The popup's **Questions left** section copies one prompt (the questions with their options and limits, the job description, your profile, resume text and saved answers) for claude.ai or chatgpt.com, so it works with Claude Pro or ChatGPT Plus. Paste the reply back and **Fill answers** puts each answer in its field. The model is told to answer `ASK_ME` instead of guessing. Job Copilot never drives the chat sites itself, since their terms forbid automating them |
| **On-device AI (free)** | If Chrome's built-in Gemini Nano is available on your computer (Prompt API), **Answer with on-device AI** drafts answers to the open questions locally: free, private, no account. It works a few questions at a time, choice questions are limited to their real options, and it answers `ASK_ME` when a fact is missing. Answers are drafts to review. Best for short or multiple-choice questions; use Claude or ChatGPT for long answers |
| **On-device check** | After each autofill, Gemini Nano (when available) is shown your profile data and the filled fields' labels, types and options, and says which profile field answers each one. It can only pick a profile field or "none", never write an answer. Fields it disagrees with are refilled from the right profile field, or cleared and outlined in purple (matches made from page attributes or learned labels), or just outlined (everything else). Results are in **Copy debug log** ("on-device check"). Turn it off in options |
| **Answer check** | Every other answer put in (yes/no worked out from your resume, saved answers, the AI's drafts, dropdown choices, work-history blocks) is shown to Gemini Nano with your profile, work history and the matching resume lines. It says **ok**, **wrong** or **unsure** for each. Wrong answers are outlined red, unsure ones amber dashed, and the side panel marks them; nothing is changed for you. A page with an answer marked wrong waits for you before Continue. Diversity answers are never sent. Same setting as the on-device check |
| **What the AI knows** | Answers and checks get: your profile, work history and schools, languages, the resume lines that match the questions, your saved answers closest to each question, and a compact job description (requirements, skills, location / work arrangement; kept when the employer tab opens from a job board, since forms like Workday's don't show it). Choice questions get their real options, including what a custom dropdown showed when it couldn't be matched |
| **Skills pickers** | Skills the job description mentions go first, then skills it asks for that your resume shows (even if not in your profile list), then skills you added yourself on earlier forms that this job mentions, then the rest of your profile skills (up to 10). The picker's own names ("Python (Programming Language)") are remembered for next time |
| **On-device answers (automatic)** | After each autofill, questions still open are sent to Gemini Nano with your profile and the matching lines of your resume, and its answers are filled in (choices limited to the real options, length limits kept). It answers "ask me" when a fact is missing, and those stay outlined for you. Never answered automatically: diversity questions, signatures and "I certify", salary/pay, criminal history, birth date, ID numbers. A page with AI answers waits for you before Continue. The side panel tags them **on-device AI**. Needs the model downloaded once (use **Answer with on-device AI** in the popup); turn it off in options |
| **Answers from your resume** | Yes/no questions are answered from the resume text and skills, without AI. "Have you built software using Python or Java?" → **Yes** when the resume or skills name Python or Java (one is enough for "or", all for "and"). Without evidence it's left for you, never answered No. "Have you ever worked at Applied Materials…?" → **Yes** if your resume lists that company, **No** if it doesn't |
| **Phone country codes** | Codes shared by several countries (+1 US/Canada/Caribbean, +44 UK/Jersey, +7…) pick the option with your code *and* your country, else the main country for that code. The code comes from the profile, else your phone's +NN, else your country |
| **Work experience & education** | Repeatable sections (Workday "My Experience" and similar: one block per job, "Add another") are filled from your work history and schools: the resume reader saves every job and school (title, company, location, dates, bullet points), editable under **Work experience & education** in options. Job Copilot clicks **Add** until there is a block per entry, then fills each one; skills are added to skills pickers. Blocks that already have values are left alone |
| **Save and Continue** | In application tabs, once a page is filled and nothing required is left for you, Job Copilot clicks Next / Continue / Save and Continue and fills the next page. If the site shows errors it stops; it never clicks Submit (the last page's button is outlined for you). Turn it off in options |
| **Side panel** | Clicking the Job Copilot icon opens it in Chrome's side panel, which stays open next to the page and follows the tab you're on. **This page** lists every question that was filled with its answer and where it came from (profile, resume, saved answer, AI / pasted), what's left for you (with **Show** to scroll to it), and recent steps (Save and Continue, on-device check fixes, sign-in waits). Values are shown only inside the extension, never returned to the page bridge. Prefer the small popup? Turn it off in options |
| **Job boards' own forms** | ZipRecruiter 1-Click Apply, LinkedIn / Indeed Easy Apply and similar: when you click them, the pop-up form is filled (only the pop-up, never the page behind it or the site's search box). Job Copilot never clicks their Continue / Submit, since on these forms Continue can submit right away |
| **Profile is the source of truth** | Many sites (iCIMS, Lever, Workday, Ashby) read your uploaded resume and fill the form themselves, often with mistakes. Autofill attaches the resume first, waits until the site has finished, then fills from your profile. It replaces profile fields whose value means something different (formatting differences such as phone punctuation or URL style don't count), keeps the site's answers to other questions, and for 90 seconds puts back profile values the site changes later. It stops for any field you edit yourself. Setting: "My profile is the source of truth" |
| **Learns from other autofills** | When another autofill (Simplify, Jobright, a site's resume reader) fills a field, and the value equals exactly one distinctive profile value, Job Copilot learns what that label means (for example "Contact No." means phone) and fills it itself next time. Only the label and the profile field are stored, never the value. Yes/no answers, demographic, date-of-birth, ID and pay questions are never learned. Learned labels are listed (and removable) in the options and noted in the debug log. It learns from results on your own forms, not from other extensions' code |
| **Debug log** | Always on. Keeps the last 300 extension steps (Apply handling, redirects caught, autofill results, confirmations, errors) in session storage, with labels and addresses only, no form values. **Copy debug log** in the popup copies it to send for a fix |
| **Record what I do** | A debugging aid in the popup. While on, it logs clicks, pop-ups (with their links and buttons), `window.open` calls, tabs that open or close, and URL changes on the current tab. **Stop & copy report** puts it on the clipboard to send. Typed values are never recorded, emails and phone numbers are blanked, and it stops automatically after 15 minutes |
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
- Everything (profile, files, saved jobs) stays in `chrome.storage.local`. Nothing is sent anywhere, except when you
  click **Read with Claude** (or turn on automatic Claude reading): then the resume file goes to `api.anthropic.com`
  with your API key. The key is stored unencrypted in `chrome.storage.local` (like the rest of your profile), is only
  used by the options page, and is never exposed to web pages or the Claude bridge.

### Permissions
- `<all_urls>` host access and content scripts: needed to detect jobs and autofill on any company careers site.
  The scripts are idle until asked, apart from a light status check for the badge.
- `scripting`: runs commands in every frame of the tab (application forms often live in iframes).
- `debugger`: only for the optional **real mouse clicks** setting, which is off by default. Chrome doesn't allow this
  permission to be optional, so it's requested at install. Nothing attaches to a tab unless the setting is on, and
  Chrome shows a "started debugging this browser" bar whenever it does.
- `storage` and `unlimitedStorage`: the profile and resume file.

## Files

```
manifest.json
src/shared/config.js          portals, trusted domains, default settings
src/shared/profile-schema.js  profile shape (shared with ~/.job-search/profile.json)
src/shared/field-rules.js     field classification + option matching (pure, unit-tested)
src/shared/resume-parser.js   resume text -> suggested profile values (pure, unit-tested)
src/shared/docx-text.js       .docx -> text without libraries
options/resume-import.js      PDF/DOCX reading + the review-and-edit panel
src/shared/claude-resume.js   schema, prompt and result mapping for "Read with Claude" (pure, unit-tested)
vendor/pdfjs/                 pdf.js 4.10.38 (Apache-2.0), used only by the options page
vendor/anthropic-sdk/         @anthropic-ai/sdk 1.3.0 (MIT) bundled by scripts/vendor-anthropic-sdk.mjs
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
