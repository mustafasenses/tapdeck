"""The deck: pages of user-assigned buttons and widgets on a grid, stored in deck.json."""

import json
import os
import re
import secrets
import threading
import time

from .apps import DEFAULT_APPS, app_name
from .config import DECK_PATH
from .keyboard import KEYCODES, MODIFIERS
from .system import mac_speaks_turkish


# Built-in actions a button can run. Labels and icons live in web/common.js.
SYSTEM_ACTIONS = [
    "media_toggle", "media_next", "media_prev", "mute", "volume_down", "volume_up",
    "brightness_down", "brightness_up", "dark_mode", "caffeinate", "screenshot",
    "mission_control", "lock", "display_off", "sleep",
]

# Live tiles the phone draws itself, with the smallest size (columns, rows)
# each still works at. Labels, icons and preset sizes live in web/common.js.
WIDGETS = {
    "now_playing": (2, 1), "clock": (1, 1), "calendar": (1, 1),
    "volume": (1, 1), "brightness": (1, 1), "stats": (1, 1),
}

# 2: the phone's fixed music page became a widget page.
DECK_VERSION = 2

ACTION_TYPES = ("hotkey", "open", "command", "text", "system", "none")
COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,24}$")
DEFAULT_COLS, DEFAULT_ROWS = 5, 2
MAX_COLS, MAX_ROWS = 6, 4
MAX_PAGES = 20


def new_id():
    return secrets.token_hex(4)


def clean_action(a):
    """Validates an action from the editor; raises ValueError if invalid."""
    if not isinstance(a, dict) or a.get("type") not in ACTION_TYPES:
        raise ValueError("bad action type")
    t = a["type"]
    if t == "hotkey":
        if a.get("code") not in KEYCODES:
            raise ValueError("bad key")
        mods = [m for m in MODIFIERS if m in (a.get("mods") or [])]
        return {"type": t, "code": a["code"], "mods": mods}
    if t in ("open", "command", "text"):
        field = {"open": "target", "command": "command", "text": "text"}[t]
        value = str(a.get(field) or "")[:5000]
        if t != "text":
            value = value.strip()
        return {"type": t, field: value}
    if t == "system":
        if a.get("id") not in SYSTEM_ACTIONS:
            raise ValueError("bad system action")
        return {"type": t, "id": a["id"]}
    return {"type": "none"}


def bounded_int(value, low, high, default):
    try:
        return max(low, min(high, int(value)))
    except (TypeError, ValueError):
        return default


def clean_item(b, cols, rows):
    """A button or widget placed on the page grid at (x, y), spanning w x h cells."""
    if not isinstance(b, dict):
        raise ValueError("bad button")
    widget = b.get("widget")
    if widget is not None and widget not in WIDGETS:
        raise ValueError("bad widget")
    w = bounded_int(b.get("w"), 1, cols, 1)
    h = bounded_int(b.get("h"), 1, rows, 1)
    x, y = bounded_int(b.get("x"), 0, 99, 0), bounded_int(b.get("y"), 0, 99, 0)
    if x + w > cols or y + h > rows:
        raise ValueError("button outside the grid")
    min_w, min_h = WIDGETS.get(widget, (1, 1))
    if w < min_w or h < min_h:
        raise ValueError("widget too small")
    bid = str(b.get("id") or "")
    item = {"id": bid if ID_RE.match(bid) else new_id(), "x": x, "y": y, "w": w, "h": h}
    if widget:
        item["widget"] = widget
        return item
    color = str(b.get("color") or "")
    item.update(
        label=str(b.get("label") or "")[:40],
        icon=str(b.get("icon") or "")[:16],
        color=color if COLOR_RE.match(color) else "",
        action=clean_action(b.get("action") or {"type": "none"}),
    )
    return item


def clean_page(p, ids):
    if not isinstance(p, dict):
        raise ValueError("bad page")
    cols = bounded_int(p.get("cols"), 2, MAX_COLS, DEFAULT_COLS)
    rows = bounded_int(p.get("rows"), 1, MAX_ROWS, DEFAULT_ROWS)
    raw = list(p.get("buttons") or [])
    # Before resizable buttons, a page was a list of 10 slots (None = empty).
    legacy = any(b is None for b in raw) or any(isinstance(b, dict) and "x" not in b for b in raw)
    taken, buttons = set(), []
    for i, b in enumerate(raw):
        if b is None:
            continue
        if legacy:
            b = dict(b, x=i % DEFAULT_COLS, y=i // DEFAULT_COLS, w=1, h=1)
        b = clean_item(b, cols, rows)
        cells = {(cx, cy) for cx in range(b["x"], b["x"] + b["w"])
                 for cy in range(b["y"], b["y"] + b["h"])}
        if cells & taken:
            raise ValueError("buttons overlap")
        taken |= cells
        while b["id"] in ids:
            b["id"] = new_id()
        ids.add(b["id"])
        buttons.append(b)
    return {"name": str(p.get("name") or "")[:30], "cols": cols, "rows": rows, "buttons": buttons}


def clean_deck(deck):
    pages = deck.get("pages") if isinstance(deck, dict) else None
    if not isinstance(pages, list) or not pages or len(pages) > MAX_PAGES:
        raise ValueError("bad pages")
    ids = set()
    cleaned = [clean_page(p, ids) for p in pages]
    has_player = any(b.get("widget") == "now_playing" for p in cleaned for b in p["buttons"])
    if deck.get("v", 1) < DECK_VERSION and not has_player and len(cleaned) < MAX_PAGES:
        # Older decks had a fixed music page before the button pages; keep it,
        # now as a page of widgets the user can move, resize or delete.
        cleaned.insert(0, clean_page(music_page(), ids))
    return {"v": DECK_VERSION, "pages": cleaned}


def music_page():
    return {"name": "Müzik" if mac_speaks_turkish() else "Music", "cols": 5, "rows": 4, "buttons": [
        {"widget": "now_playing", "x": 0, "y": 0, "w": 5, "h": 3},
        {"widget": "volume", "x": 0, "y": 3, "w": 5, "h": 1},
    ]}


def default_deck():
    tr = mac_speaks_turkish()

    def btn(label, icon, action, color=""):
        return {"id": new_id(), "label": label, "icon": icon, "color": color, "action": action}

    def system(sid):
        return btn("", "", {"type": "system", "id": sid})

    controls = [system(s) for s in (
        "mute", "dark_mode", "caffeinate", "screenshot", "mission_control",
        "brightness_down", "brightness_up", "lock", "display_off", "sleep")]

    apps, seen = [], set()
    for path in DEFAULT_APPS:
        if os.path.isdir(path) and app_name(path) not in seen:
            seen.add(app_name(path))
            apps.append(btn(app_name(path), "", {"type": "open", "target": path}))
    apps = apps[:DEFAULT_COLS * DEFAULT_ROWS]

    projects = "~/Projects" if os.path.isdir(os.path.expanduser("~/Projects")) else "~"
    docker = "orb start" if os.path.exists("/usr/local/bin/orb") else "open -a Docker"
    examples = [
        btn("Ekran kaydı" if tr else "Record screen", "🎬",
            {"type": "hotkey", "code": "Digit5", "mods": ["cmd", "shift"]}, "#ef4444"),
        btn("GitHub", "🐙", {"type": "open", "target": "https://github.com"}, "#64748b"),
        btn("Docker'ı başlat" if tr else "Start Docker", "🐳",
            {"type": "command", "command": docker}, "#3b82f6"),
        btn("Projeler" if tr else "Projects", "📁", {"type": "open", "target": projects}, "#eab308"),
        btn("Selam yaz" if tr else "Type hello", "👋",
            {"type": "text", "text": "Merhaba, " if tr else "Hello, "}, "#22c55e"),
        system("media_prev"), dict(system("media_toggle"), w=2), system("media_next"),
        system("mute"),
    ]
    return clean_deck({"v": DECK_VERSION, "pages": [
        music_page(),
        {"name": "Kontroller" if tr else "Controls", "buttons": flow(controls)},
        {"name": "Uygulamalar" if tr else "Apps", "buttons": flow(apps)},
        {"name": "Örnekler" if tr else "Examples", "buttons": flow(examples)},
    ]})


def flow(buttons, cols=DEFAULT_COLS):
    """Places buttons left to right, top to bottom (each keeps its width)."""
    x = y = 0
    for b in buttons:
        w = b.get("w", 1)
        if x + w > cols:
            x, y = 0, y + 1
        b.update(x=x, y=y, w=w, h=1)
        x += w
    return buttons


class Deck:
    def __init__(self):
        self.lock = threading.Lock()
        try:
            with open(DECK_PATH, encoding="utf-8") as f:
                self.data = clean_deck(json.load(f))
        except OSError:
            self.data = default_deck()
        except ValueError as e:
            # Never silently replace someone's buttons: keep the broken file.
            os.replace(DECK_PATH, DECK_PATH + ".bak")
            print("  deck.json couldn't be read (%s); saved it as deck.json.bak." % e)
            self.data = default_deck()
        self._write()
        self.version = int(time.time() * 1000)

    def _write(self):
        tmp = DECK_PATH + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(self.data, f, indent=2, ensure_ascii=False)
        os.replace(tmp, DECK_PATH)

    def save(self, deck):
        cleaned = clean_deck(deck)
        with self.lock:
            self.data = cleaned
            self._write()
            self.version = int(time.time() * 1000)
        return cleaned

    def full(self):
        with self.lock:
            return {"v": DECK_VERSION, "version": self.version, "pages": self.data["pages"]}

    def public(self):
        """What the phone needs to draw buttons and widgets: no commands or texts."""
        with self.lock:
            pages = []
            for p in self.data["pages"]:
                buttons = []
                for b in p["buttons"]:
                    if "widget" in b:
                        buttons.append(dict(b))
                        continue
                    a = b["action"]
                    is_app = a["type"] == "open" and a["target"].endswith(".app")
                    buttons.append({
                        "id": b["id"], "label": b["label"], "icon": b["icon"], "color": b["color"],
                        "x": b["x"], "y": b["y"], "w": b["w"], "h": b["h"],
                        "system": a.get("id") if a["type"] == "system" else None,
                        "appIcon": is_app and not b["icon"],
                        "fallback": app_name(a["target"]) if is_app else "",
                    })
                pages.append({"name": p["name"], "cols": p["cols"], "rows": p["rows"],
                              "buttons": buttons})
            return {"version": self.version, "pages": pages}

    def find(self, button_id):
        """The button with this id (widgets have no action to run)."""
        with self.lock:
            for p in self.data["pages"]:
                for b in p["buttons"]:
                    if b["id"] == button_id and "action" in b:
                        return b
        return None
