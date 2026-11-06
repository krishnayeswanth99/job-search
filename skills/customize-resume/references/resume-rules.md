# Resume tailoring rules

## Truthfulness (hard rules)
- Use only facts in `base-resume.md`, `profile.json`, or what the user said in this session.
- Never change job titles, employers, dates, degrees, or metrics. Never invent numbers.
- You may reorder bullets, rephrase them, merge or split them, drop less relevant ones, and pick up the posting's
  vocabulary **when it describes the same thing** ("ETL" vs. "data pipelines").
- A posting keyword can be added only when the base resume has evidence for it. If it's a real skill the resume doesn't
  mention, ask the user ("Have you used Airflow? Where?") before adding it.
- Never remove a whole role. That creates a gap. Shrink old or irrelevant roles to one or two bullets instead.

## Structure
- 1 page for under 8 years of experience, at most 2 pages otherwise.
- Order: Name and contact → Summary (2–3 lines) → Experience → Skills → Education → Projects or Certifications, if
  relevant.
- Role line: `### Title — Company · Location · Mon YYYY – Mon YYYY`
- 3–6 bullets for recent relevant roles and 1–3 for older ones. Each bullet is one line where possible, two at most.
- Bullet formula: **strong verb + what + how (tools) + result (number)**.
- Skills: group them (Languages / Frameworks / Cloud / Tools). Put the posting's must-haves first if the user has them.

## ATS-friendliness
- Single column. No tables, text boxes, icons, images, or headers and footers. Standard section names.
- Spell out acronyms once when the posting does: "Kubernetes (K8s)".
- File name: `<First>-<Last>-Resume-<Company>.pdf`.

## Style
- Active voice, past tense for past roles, present tense for the current one. No "I", "responsible for", or "helped".
- Plain words and short sentences. Avoid buzzwords such as passionate, synergy, rockstar, or "results-driven".
- No em dashes in prose. A hyphen or a comma is fine. (The role-line separator above is the one exception.)

## Mandatory self-review (do it before showing the user)
1. Fact check: every claim traces to the base resume or the profile. List anything new and get the user to confirm it.
2. Must-have coverage: list the posting's top 5–8 must-haves, mark ✓ (shown), ~ (implied), or ✗ (missing, can't add).
3. The keyword gap script shows coverage going up compared with the base resume.
4. Page count is within the limit (the render script warns when it's over).
5. Read it as a recruiter would for 6 seconds: are the title fit and the top 3 relevant wins obvious in the top third?
