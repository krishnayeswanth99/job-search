#!/usr/bin/env python3
"""Serve one folder on 127.0.0.1 for a limited time so the Job Copilot
extension can attach a tailored resume via jobCopilot.attachFile({ url }).

  serve_files.py <folder> [--port 8765] [--minutes 20]

Only binds to loopback, only serves files directly inside <folder> (no
directory listing, no subfolders), and exits on its own after --minutes.
"""
import argparse
import http.server
import os
import threading
import urllib.parse


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("folder")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--minutes", type=float, default=20)
    a = ap.parse_args()
    root = os.path.realpath(a.folder)
    allowed = {f for f in os.listdir(root) if os.path.isfile(os.path.join(root, f)) and f.lower().endswith((".pdf", ".docx", ".doc", ".txt"))}

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            name = urllib.parse.unquote(urllib.parse.urlsplit(self.path).path.lstrip("/"))
            if name not in allowed:
                self.send_error(404)
                return
            path = os.path.join(root, name)
            data = open(path, "rb").read()
            ctype = "application/pdf" if name.lower().endswith(".pdf") else "application/octet-stream"
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, fmt, *args):
            print("served", self.path, flush=True)

    srv = http.server.ThreadingHTTPServer(("127.0.0.1", a.port), Handler)
    threading.Timer(a.minutes * 60, srv.shutdown).start()
    print(f"Serving {sorted(allowed)} from {root} at http://127.0.0.1:{a.port}/ for {a.minutes:g} min", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
