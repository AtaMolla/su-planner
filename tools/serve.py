"""Serve SU Planner on this computer, telling the browser to check for a newer version of every
file on each load, so edits show up right away instead of an old cached copy.

Usage:
    python tools/serve.py [PORT]        (default 8765, then open http://localhost:8765/)

Python's plain `python -m http.server` sends no caching instructions, so Chrome may keep showing
pages it loaded earlier (an older page without a newly added tab, for example).
"""
import functools
import http.server
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # "no-cache" = the browser may keep a copy but must ask first; unchanged files get a quick 304.
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    handler = functools.partial(NoCacheHandler, directory=str(ROOT))
    with http.server.ThreadingHTTPServer(("127.0.0.1", port), handler) as server:
        print(f"SU Planner: http://localhost:{port}/  (Ctrl+C to stop)", flush=True)
        server.serve_forever()


if __name__ == "__main__":
    main()
