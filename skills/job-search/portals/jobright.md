# Jobright (and other aggregators) playbook

**Hosts:** `jobright.ai` (also `simplify.jobs`, `ziprecruiter.com`, `dice.com`, `builtin.com`) · **Extractor:** generic
(JSON-LD + job links) · **Login:** Jobright needs an account for its recommendations feed.

Aggregators are good for **discovering** jobs. The application almost always happens on the employer's ATS, so:

1. Open the user's feed (`/jobs/recommend`, which needs the user signed in), then run `detect()` and `extractJobs()`.
   - Jobright's cards are clickable boxes, not links. Each job has a `selector` to click, and a `url` when the card
     exposes Jobright's job ID.
   - Run `loadMoreJobs({ rounds: 8 })` to scroll the feed and collect more. Jobs that scroll off the page are kept.
   - If nothing is found, fall back to `read_page` with `filter: "interactive"`. Send a card's HTML so the extractor
     can be fixed.
2. For each promising job, open it and run `extractJob()`. Its `apply` field tells you where Apply leads:
   - `apply.target` is the employer URL when the link reveals it (redirect links are unwrapped automatically). Record it
     with `tracker.py add … --url <aggregator URL> --apply-url <apply.target>`.
   - When the target is hidden behind a script, leave `--apply-url` empty. job-apply fills it in later.
3. Score fit from the employer's own posting when you can (it's often more complete than the aggregator's summary).
4. Don't use the aggregator's own "Apply with autofill", "customize resume" or "AI apply" options. Clicking Apply on
   Jobright opens a "customize your resume?" pop-up. Take **Apply without customizing** (`followApply()` does this). job-apply goes to the employer's site
   instead. See `job-apply/references/boards-and-redirects.md`.

The markup of these sites isn't covered by a dedicated extractor yet. If the generic extractor misses jobs, capture a
card's HTML and ask for an extractor (see `_template.md`).
