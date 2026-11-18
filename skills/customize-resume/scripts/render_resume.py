#!/usr/bin/env python3
"""Render a Markdown resume to clean, ATS-friendly HTML and (if possible) PDF.

  render_resume.py resume.md [--out-dir DIR] [--pdf | --no-pdf] [--style classic|compact]

- HTML is always written (single column, real text, no tables or images, so ATS
  parsers read it reliably).
- PDF uses headless Chrome/Chromium if found (CHROME_PATH env overrides), else
  pandoc+wkhtmltopdf/weasyprint, else it prints how to save the HTML as PDF.

Supported Markdown: # name, ## section, ### role line, paragraphs, - bullets,
**bold**, *italic*, [text](url), `code`, and a contact line right under the name.
"""
import argparse
import html
import os
import re
import shutil
import subprocess
import sys

CSS = {
    "classic": """
@page { size: Letter; margin: 0.55in 0.6in; }
body { font-family: "Helvetica Neue", Arial, "Liberation Sans", sans-serif; font-size: 10.5pt; line-height: 1.35; color: #111; margin: 0; }
h1 { font-size: 20pt; margin: 0 0 2pt; letter-spacing: 0.3pt; }
.contact { color: #333; margin: 0 0 8pt; font-size: 9.5pt; }
h2 { font-size: 11pt; text-transform: uppercase; letter-spacing: 0.8pt; border-bottom: 1px solid #999; margin: 10pt 0 4pt; padding-bottom: 1pt; }
h3 { font-size: 10.5pt; margin: 6pt 0 1pt; }
p { margin: 2pt 0; }
ul { margin: 1pt 0 3pt 14pt; padding: 0; }
li { margin: 0 0 1.5pt; }
a { color: #111; text-decoration: none; }
""",
    "compact": """
@page { size: Letter; margin: 0.45in 0.5in; }
body { font-family: Arial, "Liberation Sans", sans-serif; font-size: 9.8pt; line-height: 1.28; color: #111; margin: 0; }
h1 { font-size: 17pt; margin: 0; }
.contact { margin: 0 0 5pt; font-size: 9pt; }
h2 { font-size: 10pt; text-transform: uppercase; border-bottom: 1px solid #aaa; margin: 7pt 0 3pt; }
h3 { font-size: 9.8pt; margin: 4pt 0 0; }
p { margin: 1pt 0; }
ul { margin: 0 0 2pt 13pt; padding: 0; }
li { margin: 0; }
a { color: #111; text-decoration: none; }
""",
}


def inline(s):
    s = html.escape(s, quote=False)
    s = re.sub(r"`([^`]+)`", r"<code>\1</code>", s)
    s = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", s)
    s = re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", r"<em>\1</em>", s)
    s = re.sub(r"\[([^\]]+)\]\(([^)\s]+)\)", lambda m: f'<a href="{html.escape(m.group(2))}">{m.group(1)}</a>', s)
    return s


def md_to_html(md, title, style):
    out = []
    in_list = False
    lines = md.splitlines()
    seen_h1 = False
    contact_done = False

    def close_list():
        nonlocal in_list
        if in_list:
            out.append("</ul>")
            in_list = False

    for raw in lines:
        line = raw.rstrip()
        if not line.strip():
            close_list()
            continue
        if re.match(r"^<!--.*-->$", line.strip()):
            continue
        m = re.match(r"^(#{1,3})\s+(.*)$", line)
        if m:
            close_list()
            level = len(m.group(1))
            out.append(f"<h{level}>{inline(m.group(2))}</h{level}>")
            if level == 1:
                seen_h1 = True
            else:
                contact_done = True
            continue
        m = re.match(r"^\s*[-*•]\s+(.*)$", line)
        if m:
            if not in_list:
                out.append("<ul>")
                in_list = True
            out.append(f"<li>{inline(m.group(1))}</li>")
            continue
        close_list()
        if seen_h1 and not contact_done:
            out.append(f'<p class="contact">{inline(line)}</p>')
            contact_done = True
        else:
            out.append(f"<p>{inline(line)}</p>")
    close_list()
    body = "\n".join(out)
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>{html.escape(title)}</title>
<style>{CSS[style]}</style></head>
<body>
{body}
</body></html>
"""


def find_chrome():
    cands = [os.environ.get("CHROME_PATH"), "google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome",
             "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
             "/Applications/Chromium.app/Contents/MacOS/Chromium",
             r"C:\Program Files\Google\Chrome\Application\chrome.exe",
             r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
             "/opt/pw-browsers/chromium"]
    for c in cands:
        if not c:
            continue
        p = shutil.which(c) or (c if os.path.isfile(c) else None)
        if p:
            return p
    return None


def to_pdf(html_path, pdf_path):
    chrome = find_chrome()
    if chrome:
        cmd = [chrome, "--headless=new", "--disable-gpu", "--no-sandbox", "--no-pdf-header-footer", "--print-to-pdf-no-header",
               f"--print-to-pdf={pdf_path}", "file://" + os.path.abspath(html_path)]
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=90)
        if r.returncode == 0 and os.path.exists(pdf_path):
            return f"chrome ({chrome})"
    for engine in ("weasyprint", "wkhtmltopdf"):
        if shutil.which("pandoc") and shutil.which(engine):
            r = subprocess.run(["pandoc", html_path, "-o", pdf_path, f"--pdf-engine={engine}"], capture_output=True, text=True)
            if r.returncode == 0:
                return f"pandoc+{engine}"
    return None


def pdf_pages(pdf_path):
    try:
        data = open(pdf_path, "rb").read()
        return len(re.findall(rb"/Type\s*/Page[^s]", data))
    except OSError:
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("markdown")
    ap.add_argument("--out-dir")
    ap.add_argument("--style", choices=sorted(CSS), default="classic")
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--pdf", dest="pdf", action="store_true", default=True)
    g.add_argument("--no-pdf", dest="pdf", action="store_false")
    a = ap.parse_args()

    md = open(a.markdown, encoding="utf-8").read()
    out_dir = a.out_dir or os.path.dirname(os.path.abspath(a.markdown))
    base = os.path.splitext(os.path.basename(a.markdown))[0]
    name = (re.search(r"^#\s+(.+)$", md, re.M) or [None, base])[1].strip()
    html_path = os.path.join(out_dir, base + ".html")
    with open(html_path, "w", encoding="utf-8") as f:
        f.write(md_to_html(md, f"{name} - Resume", a.style))
    print(f"HTML: {html_path}")
    if not a.pdf:
        return
    pdf_path = os.path.join(out_dir, base + ".pdf")
    how = to_pdf(html_path, pdf_path)
    if how:
        pages = pdf_pages(pdf_path)
        print(f"PDF:  {pdf_path}  (via {how}{f', {pages} page(s)' if pages else ''})")
        if pages and pages > 2:
            print("WARNING: more than 2 pages. Tighten bullets or use --style compact.", file=sys.stderr)
    else:
        print("PDF:  not generated (no Chrome/Chromium or pandoc PDF engine found). Open the HTML in Chrome and Print -> Save as PDF.")


if __name__ == "__main__":
    main()
