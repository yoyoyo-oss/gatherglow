"""Local development server: serves public/ and the same API as Vercel.

    python3 dev_server.py            # http://localhost:3000

Uses a local JSON file for storage unless SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are set.
Reads environment variables from .env if present.
"""
import json
import mimetypes
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))


def load_env():
    path = os.path.join(ROOT, ".env")
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"'))


load_env()
os.environ.setdefault("LOCAL_STORE_FILE", os.path.join(ROOT, ".data", "store.json"))
sys.path.insert(0, os.path.join(ROOT, "api"))
import index as api  # noqa: E402

PUBLIC = os.path.join(ROOT, "public")


class Dev(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.command, self.path))

    def _api(self, method):
        n = int(self.headers.get("content-length") or 0)
        raw = self.rfile.read(n).decode("utf-8") if n else ""
        status, payload = api.handle(method, self.path, {k.lower(): v for k, v in self.headers.items()}, raw)
        out = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)

    def _static(self):
        path = self.path.split("?", 1)[0]
        if path == "/" or path.startswith("/p/"):
            path = "/index.html"
        full = os.path.normpath(os.path.join(PUBLIC, path.lstrip("/")))
        if not full.startswith(PUBLIC) or not os.path.isfile(full):
            self.send_error(404)
            return
        with open(full, "rb") as f:
            data = f.read()
        self.send_response(200)
        self.send_header("Content-Type", mimetypes.guess_type(full)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        self._api("GET") if self.path.startswith("/api/") else self._static()

    def do_POST(self):
        self._api("POST")

    def do_PUT(self):
        self._api("PUT")


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "3000"))
    print("GatherGlow on http://localhost:%d  (storage: %s)" % (port, api.store.kind))
    ThreadingHTTPServer(("127.0.0.1", port), Dev).serve_forever()
