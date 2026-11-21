#!/usr/bin/env python3
"""Dev server for Veggie Bros.: stdlib http.server + Cache-Control: no-store.

`python3 -m http.server` sends no cache headers, so the browser falls back to
heuristic freshness — and a standard F5 can re-serve a STALE ES module even
though the file on disk changed (observed live: a fresh page ran an old nested
module after a reload). no-store makes every refresh a network fetch. For a
local dev server of a few hundred KB of JS that cost is nil, and "the files in
the page are the files on disk" then always holds — no cache-busting recipe.

Usage: python3 tools/serve.py [port] [--bind ADDR]   (port defaults to 8010)
The serve-*.sh scripts exec this; stop-server.sh matches both this and the
plain `python3 -m http.server` it used to start.
"""
import argparse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoStoreHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main():
    ap = argparse.ArgumentParser(description="Veggie Bros. dev server (no-store)")
    ap.add_argument("port", nargs="?", type=int, default=8010)
    ap.add_argument("--bind", default="127.0.0.1")
    args = ap.parse_args()
    httpd = ThreadingHTTPServer((args.bind, args.port), NoStoreHandler)
    print(f"serving on http://{args.bind}:{args.port} (Cache-Control: no-store)")
    httpd.serve_forever()


if __name__ == "__main__":
    main()
