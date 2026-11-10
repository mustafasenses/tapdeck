"""HTTP routes: the phone app and its API, the Mac-only editor, the extension."""

import hmac
import json
import os
import re
import socket
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

from .apps import app_icon, installed_apps
from .config import WEB_DIR
from .deck import SYSTEM_ACTIONS, clean_action
from .icon import icon_png
from .keyboard import KEYCODES
from .shell import run


LOCAL_ADDRS = ("127.0.0.1", "::1", "::ffff:127.0.0.1")


# Stylesheets and scripts under web/css and web/js, by name only (no paths).
STATIC_RE = re.compile(r"/(css|js)/([a-z0-9-]+)\.(css|js)")
CONTENT_TYPES = {"css": "text/css; charset=utf-8", "js": "text/javascript; charset=utf-8"}


def template(name, **values):
    """A page from web/ with __KEY__ placeholders filled in."""
    with open(os.path.join(WEB_DIR, name), encoding="utf-8") as f:
        page = f.read()
    for key, value in values.items():
        page = page.replace("__%s__" % key.upper(), value)
    return page.encode("utf-8")


class Handler(BaseHTTPRequestHandler):
    server_version = "Tapdeck/2.0"
    panel = None  # set by cli.main()

    def log_message(self, fmt, *args):
        pass

    # -- plumbing ----------------------------------------------------------

    def _send(self, code, body=b"", ctype="application/json", cache=False):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "max-age=86400" if cache else "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, obj, code=200):
        self._send(code, json.dumps(obj, ensure_ascii=False).encode("utf-8"))

    def _file(self, name, ctype):
        try:
            with open(os.path.join(WEB_DIR, name), "rb") as f:
                body = f.read()
        except OSError:
            return self._send(404)
        self._send(200, body, ctype)

    def _body(self):
        length = int(self.headers.get("Content-Length") or 0)
        try:
            return json.loads(self.rfile.read(length) or b"{}")
        except ValueError:
            return {}

    def _authed(self, query):
        token = self.headers.get("X-Token") or query.get("t", [""])[0]
        return hmac.compare_digest(token.encode(), self.panel.token.encode())

    def _on_this_mac(self):
        # The Host check stops DNS-rebinding pages from reading local-only pages.
        port = self.panel.cfg["port"]
        host = self.headers.get("Host") or ""
        return (self.client_address[0] in LOCAL_ADDRS
                and host in ("127.0.0.1:%d" % port, "localhost:%d" % port))

    def _from_extension(self):
        # Only the extension on this Mac. Web pages can't send the custom header
        # cross-origin without a CORS preflight, which this server never grants.
        origin = self.headers.get("Origin") or ""
        return (self.client_address[0] in LOCAL_ADDRS
                and self.headers.get("X-Tapdeck") == "1"
                and not origin.startswith(("http:", "https:")))

    # -- routes ------------------------------------------------------------

    def do_GET(self):
        url = urlparse(self.path)
        path, query = url.path, parse_qs(url.query)
        p = self.panel

        if path in ("/", "/index.html"):
            return self._file("index.html", "text/html; charset=utf-8")
        m = STATIC_RE.fullmatch(path)
        if m and m.group(1) == m.group(3):
            return self._file(path[1:], CONTENT_TYPES[m.group(3)])
        if path == "/icon.png":
            return self._send(200, icon_png(), "image/png", cache=True)

        # Mac-only pages: they carry the token, so never serve them elsewhere.
        if path in ("/connect", "/edit"):
            if not self._on_this_mac():
                return self._send(404)
            if path == "/connect":
                url, alt = phone_urls(p.cfg)
                page = template("connect.html", url=url, alt=alt)
            else:
                page = template("edit.html", token=p.token)
            return self._send(200, page, "text/html; charset=utf-8")

        if path == "/ext/wait":
            if not self._from_extension():
                return self._send(403)
            return self._json({"commands": p.media.wait()})

        if not path.startswith("/api/"):
            return self._send(404)
        if not self._authed(query):
            return self._json({"error": "unauthorized"}, 401)

        if path == "/api/status":
            return self._json(p.status())
        if path == "/api/stats":
            return self._json(p.stats.get())
        if path == "/api/deck":
            return self._json(p.deck.public())
        m = re.fullmatch(r"/api/deck/icon/([A-Za-z0-9_-]+)", path)
        if m:
            b = p.deck.find(m.group(1))
            png = b and b["action"]["type"] == "open" and app_icon(b["action"]["target"])
            return self._send(200, png, "image/png", cache=True) if png else self._send(404)

        if path.startswith("/api/editor/"):
            if not self._on_this_mac():
                return self._send(403)
            if path == "/api/editor/deck":
                return self._json(p.deck.full())
            if path == "/api/editor/meta":
                return self._json({
                    "apps": installed_apps(), "keys": list(KEYCODES),
                    "system": SYSTEM_ACTIONS, "accessibility": p.keys.trusted(),
                    "phoneUrl": phone_urls(p.cfg)[0],
                })
            if path == "/api/editor/appicon":
                png = app_icon(query.get("path", [""])[0])
                return self._send(200, png, "image/png", cache=True) if png else self._send(404)
        self._send(404)

    def do_POST(self):
        url = urlparse(self.path)
        path, query = url.path, parse_qs(url.query)
        p = self.panel

        if path.startswith("/ext/"):
            if not self._from_extension():
                return self._send(403)
            body = self._body()
            if path == "/ext/state" and isinstance(body.get("state"), dict):
                p.media.update(str(body.get("key")), body["state"])
            elif path == "/ext/gone":
                p.media.remove(key=body.get("key"), tab=body.get("tab"))
            elif path == "/ext/unhandled":
                # The tab couldn't do it (e.g. no "next" button): use media keys.
                p.media.fallback(body.get("cmd"))
            return self._json({"ok": True})

        if not self._authed(query):
            return self._json({"error": "unauthorized"}, 401)
        body = self._body()

        if path == "/api/action":
            try:
                return self._json(p.action(body.get("action"), body.get("value")))
            except (TypeError, ValueError):
                return self._json({"ok": False, "error": "bad_request"}, 400)

        # Editing (and testing) buttons is only possible on the Mac itself:
        # buttons can run commands, so the phone may only press them.
        if path.startswith("/api/editor/"):
            if not self._on_this_mac():
                return self._send(403)
            try:
                if path == "/api/editor/save":
                    saved = p.deck.save(body)
                    return self._json({"ok": True, "version": p.deck.version, "pages": saved["pages"]})
                if path == "/api/editor/test":
                    return self._json(p.run_action(clean_action(body.get("action"))))
                if path == "/api/editor/accessibility":
                    p.keys.request_access()
                    return self._json({"ok": True})
            except ValueError as e:
                return self._json({"ok": False, "error": str(e)}, 400)
        self._send(404)


def lan_ip():
    for iface in ("en0", "en1"):
        ip = run(["ipconfig", "getifaddr", iface])
        if ip:
            return ip
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))  # no packets are sent
            return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"


def phone_urls(cfg):
    host = run(["scutil", "--get", "LocalHostName"]) or socket.gethostname().split(".")[0]
    suffix = ":%d/?t=%s" % (cfg["port"], cfg["token"])
    return "http://%s.local%s" % (host, suffix), "http://%s%s" % (lan_ip(), suffix)
