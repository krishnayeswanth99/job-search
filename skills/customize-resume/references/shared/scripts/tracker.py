#!/usr/bin/env python3
"""Job tracker for ~/.job-search/tracker.csv (stdlib only).

Usage:
  tracker.py init
  tracker.py add --portal P --company C --title T --url U [--location L] [--fit F] [--status S] [--notes N]
  tracker.py exists --url U                  exit 0 and print the row if tracked, else exit 1
  tracker.py get --id N | --url U
  tracker.py update --id N [--status S] [--fit F] [--folder D] [--notes N] [--applied]
  tracker.py list [--status S[,S2]] [--fit F[,F2]] [--portal P] [--limit N]
  tracker.py slug --company C --title T      folder name for a job
  tracker.py stats

All output is JSON so skills can parse it.
"""
import argparse
import csv
import datetime as dt
import json
import os
import re
import sys
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

HOME = os.path.expanduser(os.environ.get("JOB_SEARCH_HOME", "~/.job-search"))
TRACKER = os.path.join(HOME, "tracker.csv")
COLUMNS = ["id", "found_at", "portal", "company", "title", "location", "url", "fit", "status", "applied_at", "folder", "notes"]
STATUSES = {"found", "shortlisted", "tailored", "applying", "applied", "skipped", "blocked", "closed", "interview", "offer", "rejected"}
TRACKING_PARAMS = re.compile(r"^(utm_.*|ref|refid|trackingid|trk|trkinfo|src|source|gh_src|lever-source|lever-origin|ebp|eid|from|position|pagenum|origin)$", re.I)


def now():
    return dt.datetime.now().replace(microsecond=0).isoformat()


def canonical_url(url):
    """Normalize a job URL so the same posting is detected across visits."""
    url = (url or "").strip()
    if not url:
        return ""
    m = re.search(r"linkedin\.com/.*?(?:jobs/view/(?:[^/?]*-)?|currentJobId=)(\d+)", url)
    if m:
        return f"https://www.linkedin.com/jobs/view/{m.group(1)}/"
    m = re.search(r"indeed\.[a-z.]+/.*?[?&](?:jk|vjk)=([a-z0-9]+)", url, re.I)
    if m:
        return f"https://www.indeed.com/viewjob?jk={m.group(1)}"
    parts = urlsplit(url)
    query = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if not TRACKING_PARAMS.match(k)]
    path = parts.path.rstrip("/") or "/"
    path = re.sub(r"/apply/?$", "", path) if "lever.co" in parts.netloc else path
    return urlunsplit((parts.scheme.lower() or "https", parts.netloc.lower(), path, urlencode(query), ""))


def slugify(s, n=40):
    s = re.sub(r"[^a-z0-9]+", "-", (s or "").lower()).strip("-")
    return s[:n].rstrip("-") or "x"


def folder_name(company, title):
    return f"{slugify(company, 30)}-{slugify(title, 40)}-{dt.date.today().isoformat()}"[:80]


def read_rows():
    if not os.path.exists(TRACKER):
        return []
    with open(TRACKER, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def write_rows(rows):
    os.makedirs(HOME, exist_ok=True)
    tmp = TRACKER + ".tmp"
    with open(tmp, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow({c: r.get(c, "") for c in COLUMNS})
    os.replace(tmp, TRACKER)


def find(rows, id_=None, url=None):
    if id_ is not None:
        return next((r for r in rows if r["id"] == str(id_)), None)
    cu = canonical_url(url)
    return next((r for r in rows if canonical_url(r["url"]) == cu), None) if cu else None


def out(obj, code=0):
    print(json.dumps(obj, indent=2, ensure_ascii=False))
    sys.exit(code)


def cmd_init(_):
    for d in ["", "resume", "jobs", "searches"]:
        os.makedirs(os.path.join(HOME, d), exist_ok=True)
    if not os.path.exists(TRACKER):
        write_rows([])
    out({"home": HOME, "tracker": TRACKER, "ok": True})


def cmd_add(a):
    rows = read_rows()
    existing = find(rows, url=a.url)
    if existing:
        out({"added": False, "reason": "already tracked", "row": existing})
    if a.status and a.status not in STATUSES:
        out({"error": f"unknown status {a.status}", "allowed": sorted(STATUSES)}, 2)
    next_id = max([int(r["id"]) for r in rows if r["id"].isdigit()] + [0]) + 1
    row = {
        "id": str(next_id), "found_at": now(), "portal": a.portal or "", "company": a.company or "", "title": a.title or "",
        "location": a.location or "", "url": canonical_url(a.url), "fit": a.fit or "", "status": a.status or "found",
        "applied_at": "", "folder": "", "notes": a.notes or "",
    }
    rows.append(row)
    write_rows(rows)
    out({"added": True, "row": row})


def cmd_exists(a):
    r = find(read_rows(), url=a.url)
    out({"exists": bool(r), "row": r}, 0 if r else 1)


def cmd_get(a):
    r = find(read_rows(), id_=a.id, url=a.url)
    out({"row": r}, 0 if r else 1)


def cmd_update(a):
    rows = read_rows()
    r = find(rows, id_=a.id, url=a.url)
    if not r:
        out({"error": "not found"}, 1)
    if a.status:
        if a.status not in STATUSES:
            out({"error": f"unknown status {a.status}", "allowed": sorted(STATUSES)}, 2)
        r["status"] = a.status
        if a.status == "applied" and not r.get("applied_at"):
            r["applied_at"] = now()
    for k in ("fit", "folder", "location", "company", "title"):
        v = getattr(a, k, None)
        if v:
            r[k] = v
    if a.notes:
        r["notes"] = (r.get("notes", "") + " | " if r.get("notes") else "") + a.notes
    write_rows(rows)
    out({"updated": True, "row": r})


def cmd_list(a):
    rows = read_rows()
    if a.status:
        allowed = set(a.status.split(","))
        rows = [r for r in rows if r["status"] in allowed]
    if a.fit:
        allowed = {x.lower() for x in a.fit.split(",")}
        rows = [r for r in rows if r["fit"].lower() in allowed]
    if a.portal:
        rows = [r for r in rows if r["portal"] == a.portal]
    rows = rows[-a.limit:] if a.limit else rows
    out({"count": len(rows), "rows": rows})


def cmd_slug(a):
    out({"folder": folder_name(a.company, a.title), "path": os.path.join(HOME, "jobs", folder_name(a.company, a.title))})


def cmd_stats(_):
    rows = read_rows()
    by = {}
    for r in rows:
        by[r["status"]] = by.get(r["status"], 0) + 1
    out({"total": len(rows), "by_status": by})


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("init")
    s = sub.add_parser("add")
    for f in ("portal", "company", "title", "location", "fit", "status", "notes"):
        s.add_argument("--" + f)
    s.add_argument("--url", required=True)
    s = sub.add_parser("exists")
    s.add_argument("--url", required=True)
    s = sub.add_parser("get")
    s.add_argument("--id")
    s.add_argument("--url")
    s = sub.add_parser("update")
    s.add_argument("--id")
    s.add_argument("--url")
    for f in ("status", "fit", "folder", "notes", "location", "company", "title"):
        s.add_argument("--" + f)
    s = sub.add_parser("list")
    s.add_argument("--status")
    s.add_argument("--fit")
    s.add_argument("--portal")
    s.add_argument("--limit", type=int, default=0)
    s = sub.add_parser("slug")
    s.add_argument("--company", required=True)
    s.add_argument("--title", required=True)
    sub.add_parser("stats")
    a = p.parse_args()
    {"init": cmd_init, "add": cmd_add, "exists": cmd_exists, "get": cmd_get, "update": cmd_update, "list": cmd_list, "slug": cmd_slug, "stats": cmd_stats}[a.cmd](a)


if __name__ == "__main__":
    main()
