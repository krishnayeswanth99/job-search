# Fit scoring

Score each job against `base-resume.md`, `profile.json`, and `preferences.md`. Be calibrated: most jobs are *not* High.

## Gates (any one fails → **Skip**)
- A deal-breaker in `preferences.md` is present (for example a clearance requirement, or an excluded company).
- Work authorization: the job says it doesn't sponsor and `requiresSponsorship` is "Yes".
- Location or arrangement is incompatible (for example onsite in another country with no relocation).
- Seniority is off by two or more levels (for example an intern role for a senior candidate).
- Salary is posted and its maximum is below the user's floor.

## Score (only if no gate fails)

| Factor | Weight | How to judge |
|---|---|---|
| Must-have skills | 40% | Share of the listed hard requirements the resume shows evidence of |
| Role / title alignment | 20% | Same function and level as target titles |
| Domain / industry | 15% | Experience in the same domain or similar products |
| Nice-to-haves | 10% | Preferred qualifications matched |
| Preferences | 15% | Remote/hybrid match, salary in range, company stage/size, dream company bonus |

- **High**: 75% or more, and no must-have is clearly missing. Worth tailoring a resume for.
- **Medium**: 55–74%, or one learnable must-have is missing.
- **Low**: below 55%.

Write 1–2 lines of evidence per job, for example: "Must-haves 5/6 (no Go). Senior IC, matches. Remote US. $190–230k,
above floor."

Never inflate a score to make the list look better. If the description is too thin to judge, say "insufficient info"
and score it Medium at most.
