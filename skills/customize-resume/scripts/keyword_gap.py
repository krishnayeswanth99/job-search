#!/usr/bin/env python3
"""Compare a job posting with a resume and list important terms the resume lacks.

  keyword_gap.py posting.md resume.md [--top 40] [--json]

This is a heuristic helper (term frequency + a tech/skills vocabulary), not a
ranking oracle. Claude decides what is truthful to add; never add a term the
candidate has no evidence for.
"""
import argparse
import json
import re
from collections import Counter

STOP = set("""a about above across after again against all also am an and any are as at be because been before being below between both
but by can could did do does doing down during each few for from further had has have having he her here hers herself him himself his how
i if in into is it its itself just me more most my myself no nor not now of off on once only or other our ours ourselves out over own same
she should so some such than that the their theirs them themselves then there these they this those through to too under until up very was
we were what when where which while who whom why will with would you your yours yourself yourselves role team teams work working job
company candidate candidates experience experiences year years ability able strong excellent including include includes etc new using use
within across help join looking opportunity responsibilities requirements qualifications preferred required plus bonus benefits
salary equity apply application applicants equal employer status gender race religion disability veteran national origin sexual
orientation identity age protected law policy please us we're you'll you're it's what's who's day days time based level well like
make makes building build built drive drives deliver delivering great good best world people product products customer customers
nice senior junior mid lead principal staff requirement must should ideal ideally familiarity understanding knowledge""".split())

# Multi-word skills worth matching as phrases.
PHRASES = [
    "machine learning", "deep learning", "natural language processing", "computer vision", "large language models", "data pipelines",
    "distributed systems", "system design", "ci/cd", "infrastructure as code", "event driven", "rest api", "rest apis", "graphql",
    "a/b testing", "product management", "project management", "stakeholder management", "cross-functional", "unit testing",
    "test automation", "data modeling", "data warehouse", "feature engineering", "model deployment", "mlops", "site reliability",
    "incident response", "code review", "microservices", "real-time", "front end", "back end", "full stack", "react native",
    "google cloud", "amazon web services", "spark streaming", "time series", "recommendation systems", "reinforcement learning",
]


def norm(text):
    return re.sub(r"\s+", " ", text.lower())


def terms(text):
    t = norm(text)
    found = Counter()
    for p in PHRASES:
        n = t.count(p)
        if n:
            found[p] += n
    for w in re.findall(r"[a-z][a-z0-9+#./-]{1,30}", t):
        w = w.strip(".-/")
        if len(w) < 2 or w in STOP or w.isdigit():
            continue
        found[w] += 1
    # Drop single words already counted as part of a matched phrase ("machine" in "machine learning").
    phrase_words = {w for p in found if " " in p for w in p.split()}
    for w in phrase_words:
        found.pop(w, None)
    return found


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("posting")
    ap.add_argument("resume")
    ap.add_argument("--top", type=int, default=40)
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    post = open(a.posting, encoding="utf-8").read()
    res = norm(open(a.resume, encoding="utf-8").read())
    pt = terms(post)
    ranked = [(w, c) for w, c in pt.most_common() if c >= 1][: a.top * 3]
    present = [(w, c) for w, c in ranked if re.search(r"(?<![a-z0-9])" + re.escape(w) + r"(?![a-z0-9])", res)]
    missing = [(w, c) for w, c in ranked if (w, c) not in present]
    coverage = round(100 * len(present) / max(1, len(present) + len(missing)))
    result = {"coverage_pct": coverage, "present": [w for w, _ in present[: a.top]], "missing": [w for w, _ in missing[: a.top]]}
    if a.json:
        print(json.dumps(result, indent=2))
    else:
        print(f"Keyword coverage: {coverage}% of the top posting terms")
        print("Missing (only add if TRUE for the candidate):", ", ".join(result["missing"]))
        print("Present:", ", ".join(result["present"]))


if __name__ == "__main__":
    main()
