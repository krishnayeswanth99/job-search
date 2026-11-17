# From a job board or aggregator to the real application

LinkedIn, Indeed, Glassdoor, ZipRecruiter, Dice, Built In, Jobright and Simplify mostly **list** jobs. Applying usually
happens on the employer's applicant tracking system (Greenhouse, Lever, Workday…). Getting there can involve a new tab,
a redirect URL, or an "are you sure?" screen. Job Copilot reports all of it in `detect()`.

## Step by step

1. `const d = await jobCopilot.detect()` on the posting.
   - `d.apply.kind === 'easy-apply'`: an on-site flow (LinkedIn Easy Apply, Indeed Apply, Glassdoor Easy Apply). Click
     `d.apply.selector` and follow `ats/linkedin-easy-apply.md` or `ats/indeed.md`. Do **not** call `followApply()`.
   - `d.apply.kind === 'external'` or `'onsite'`: go on to step 2.
2. **Prefer staying in the same tab:** `await jobCopilot.followApply()`.
   - `{ ok: true, action: 'navigate', to }`: the tab is going to the employer's page. Wait about 2 s, then run `detect()`
     again.
   - `{ ok: false, reason: 'scripted' … }`: the button has no link (LinkedIn's external "Apply" works this way). Go to
     step 3.
3. **New tab:** click `d.apply.selector` with `computer` (or `find("Apply button")`). Then:
   - run `detect()` on the **original** tab. `openedTabs` lists tabs it just opened (`url`, `title`), and/or
   - run `tabs_context_mcp` and switch to the new tab.
   - If the new tab isn't one you can control, `navigate` your own tab to `openedTabs[0].url` instead.
4. **"You're leaving …" / "Continue to company site" screens:** `detect().interstitial` gives the button text.
   `followApply()` continues through it, or you can click `interstitial.selector`.
5. **Redirect hops** (`pageType: 'redirect'`, such as `indeed.com/applystart`, `linkedin.com/redir`, or a
   `…?url=https%3A…` link): `followApply()` jumps straight to `redirect.target`.
6. On the destination, run `detect()` again. Expect `pageType: 'job'` (click its Apply button too: many ATS put the form
   one click further) or `'application'`. Load the matching `ats/*.md` playbook.
7. **Record where the application really is:**
   `tracker.py update --id N --apply-url "<ATS URL>"`. Then the same job found later on the employer's own board is
   recognized as a duplicate.

## Jobright (recorded on the real site)

1. **Apply** or **Apply with Autofill** opens an empty window as a pop-up check and closes it.
2. A **"Customize Your Resume in 10 seconds"** pop-up offers **Fix My Resume Now** or **Apply Without Customizing**.
   Both are buttons, not links.
3. **Apply Without Customizing** opens another empty window and then sends it to the employer's application, for
   example `job-boards.greenhouse.io/embed/job_app?for=<company>&token=…`.
4. The Jobright tab asks **"Did you apply?"**.

Script clicks don't count as the user's, so Chrome's pop-up blocker would stop those windows. `followApply()` handles
this:
- While it clicks through, it stands in for the window-opening function and catches the employer address.
- It never chooses "Fix My Resume Now".
- It then opens the address itself, in the same tab, or next to Jobright with `followApply({ newTab: true })`.
- Answer "Did you apply?" only after a confirmed submission. Otherwise close it or answer "No".

On the feed, `resolveApplyLinks({ viaApply: true })` does the same per card without leaving the page. It closes
Jobright's pop-ups without answering them, about one job every 2 s, 10 per run.

## Pre-apply pop-ups (upsells)

Aggregators often put a pop-up between **Apply** and the employer's site. Jobright, for example, offers to customize
your resume first, with **Customize Resume** and **Apply without customizing** options.
- `detect().interstitial` with `kind: 'upsell'` names the skip option (`button`, `selector`, and `href` when it's a link).
- `followApply()` takes it: it navigates to `href`, or clicks the button, which may open a new tab (check
  `detect().openedTabs`).
- **Never** pick the site's own customize, tailor, "AI optimize", upgrade or "Apply with Autofill" options. They change
  the resume outside our no-fabrication rules, and may cost money. Tailoring is done by the `customize-resume` skill,
  and the tailored PDF is attached on the employer's form.
- On a job page with both **Apply with Autofill** and **Apply**, use plain **Apply**. `detect().apply` already prefers
  it.

## "Did you apply?" prompts

LinkedIn, Jobright, Simplify and others ask this when you return to their tab (`detect().appliedPrompt`).
- Click **Yes** (`appliedPrompt.yesSelector`) **only** after you saw the employer's confirmation for this job.
- Otherwise click **No / Not yet** (`noSelector`), or leave it for the user. Never click "Yes" just to dismiss the
  prompt: it would mark the job applied on that site.

## Other autofill extensions

If the user also has Jobright's, Simplify's or a similar autofill extension enabled, both may fill the same form and
overwrite each other. Ask the user to pause the other one while Job Copilot is active. Also ignore any "Autofill with
Jobright/Simplify" overlays on the page.

## Things that are the user's call

- "Share my profile with the employer?" or "Save this job?" opt-ins on the board: skip them unless the user asked.
- A board that requires its own account just to see the apply link (Glassdoor, Wellfound, Jobright): stop and ask
  the user to sign in (`login-and-signup.md`).
