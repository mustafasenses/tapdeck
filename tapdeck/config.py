"""Where Tapdeck keeps its files, and config.json (port and access token)."""

import json
import os
import secrets

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB_DIR = os.path.join(ROOT, "web")
CACHE_DIR = os.path.join(ROOT, ".cache")
CONFIG_PATH = os.path.join(ROOT, "config.json")
DECK_PATH = os.path.join(ROOT, "deck.json")

DEFAULT_PORT = 8765

# The phone app's files: when one changes, open phones reload themselves.
PHONE_FILES = ("index.html", "css/base.css", "css/phone.css", "js/common.js", "js/phone.js")


def load_config():
    cfg = {}
    if os.path.exists(CONFIG_PATH):
        with open(CONFIG_PATH, encoding="utf-8") as f:
            cfg = json.load(f)
    changed = False
    defaults = {"port": DEFAULT_PORT, "token": secrets.token_urlsafe(16)}
    for key, value in defaults.items():
        if not cfg.get(key):
            cfg[key] = value
            changed = True
    if changed:
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(cfg, f, indent=2, ensure_ascii=False)
        os.chmod(CONFIG_PATH, 0o600)
    return cfg


def web_build():
    return max(int(os.stat(os.path.join(WEB_DIR, f)).st_mtime) for f in PHONE_FILES)
