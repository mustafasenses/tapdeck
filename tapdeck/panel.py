"""Everything the phone and the editor can do, and the state behind it."""

import os
import threading
import time
from datetime import datetime

from .config import web_build
from .deck import Deck, SYSTEM_ACTIONS
from .display import Brightness
from .keyboard import KEYCODES, MODIFIERS, Keyboard
from .media import MediaHub
from .shell import open_target, osa, run, run_command
from .system import Caffeinate, CpuMeter, battery, get_volume, memory, screenshot_dir


class TTLCache:
    """Caches a zero-argument function's result for a few seconds."""

    def __init__(self, fn, ttl):
        self.fn, self.ttl = fn, ttl
        self.value, self.at = None, 0.0
        self.lock = threading.Lock()

    def get(self):
        with self.lock:
            if time.time() - self.at > self.ttl:
                self.value, self.at = self.fn(), time.time()
            return self.value

    def clear(self):
        with self.lock:
            self.at = 0.0


class Panel:
    """All server state, shared by request handlers."""

    def __init__(self, cfg):
        self.cfg = cfg
        self.token = cfg["token"]
        self.brightness = Brightness()
        self.keys = Keyboard()
        self.cpu = CpuMeter()
        self.caffeinate = Caffeinate()
        self.media = MediaHub(self.keys)
        self.deck = Deck()
        self.volume = TTLCache(get_volume, 0.7)
        self.stats = TTLCache(self._stats, 1.5)

    def _stats(self):
        return {
            "cpu": self.cpu.sample(),
            "memory": memory(),
            "battery": battery(),
            "dark": run(["defaults", "read", "-g", "AppleInterfaceStyle"]) == "Dark",
            "caffeinate": self.caffeinate.on,
        }

    def status(self):
        vol, muted = self.volume.get()
        return {
            "volume": vol,
            "muted": muted,
            "brightness": self.brightness.get(),
            "media": self.media.status(),
            "deckVersion": self.deck.version,
            "build": web_build(),
        }

    # -- phone requests ----------------------------------------------------

    def action(self, name, value):
        """Handles a request from the phone: {"ok": bool, "error"?, "output"?}."""
        if name == "deck":
            button = self.deck.find(str(value))
            if not button:
                return {"ok": False, "error": "bad_request"}
            return self.run_action(button["action"])
        if name == "media":
            if value not in ("toggle", "next", "prev"):
                return {"ok": False, "error": "bad_request"}
            return self._result(*self.media.command(value))
        if name == "seek":
            return self._result(*self.media.command("seek", float(value)))
        if name == "volume":
            return {"ok": self.set_volume(int(value))}
        if name == "brightness":
            return {"ok": self.brightness.set(float(value))}
        if name in SYSTEM_ACTIONS:
            return self.system(name)
        return {"ok": False, "error": "bad_request"}

    @staticmethod
    def _result(ok, error=None):
        out = {"ok": bool(ok)}
        if error:
            out["error"] = error
        return out

    # -- button actions ----------------------------------------------------

    def run_action(self, a):
        t = a["type"]
        if t == "system":
            return self.system(a["id"])
        if t == "open":
            return {"ok": bool(a["target"]) and open_target(a["target"])}
        if t == "command":
            return run_command(a["command"]) if a["command"] else {"ok": False}
        if t in ("hotkey", "text"):
            if not self.keys.trusted():
                return {"ok": False, "error": "accessibility"}
            if t == "text":
                return {"ok": self.keys.type_text(a["text"])}
            flags = sum(MODIFIERS[m] for m in a["mods"])
            return {"ok": self.keys.shortcut(KEYCODES[a["code"]], flags)}
        return {"ok": True}

    def set_volume(self, v):
        v = max(0, min(100, v))
        ok = osa("set volume output volume %d\nset volume output muted false" % v) is not None
        self.volume.clear()
        return ok

    def system(self, name):
        ok, error = True, None
        if name in ("media_toggle", "media_next", "media_prev"):
            ok, error = self.media.command(name.split("_")[1])
        elif name in ("volume_up", "volume_down"):
            vol, _ = self.volume.get()
            ok = vol is not None and self.set_volume(vol + (10 if name == "volume_up" else -10))
        elif name in ("brightness_up", "brightness_down"):
            cur = self.brightness.get()
            ok = cur is not None and self.brightness.set(
                cur + (10 if name == "brightness_up" else -10))
        elif name == "mute":
            _, muted = self.volume.get()
            ok = osa("set volume output muted %s" % ("false" if muted else "true")) is not None
            self.volume.clear()
        elif name == "lock":
            # Ctrl+Cmd+Q locks the Mac; without Accessibility, turning the
            # display off locks it too if a password is required after sleep.
            ok = (self.keys.shortcut(KEYCODES["KeyQ"], MODIFIERS["cmd"] | MODIFIERS["ctrl"])
                  or run(["pmset", "displaysleepnow"]) is not None)
        elif name == "display_off":
            ok = run(["pmset", "displaysleepnow"]) is not None
        elif name == "sleep":
            # Delay so the phone gets its response before the Mac sleeps.
            threading.Timer(1.0, run, [["pmset", "sleepnow"]]).start()
        elif name == "mission_control":
            ok = run(["open", "-a", "Mission Control"]) is not None
        elif name == "screenshot":
            stamp = datetime.now().strftime("%Y-%m-%d %H.%M.%S")
            path = os.path.join(screenshot_dir(), "Tapdeck %s.png" % stamp)
            ok = run(["screencapture", "-x", path], 15) is not None
        elif name == "dark_mode":
            ok = osa('tell application "System Events" to tell appearance preferences '
                     'to set dark mode to not dark mode') is not None
            if not ok:
                error = "automation"
            self.stats.clear()
        elif name == "caffeinate":
            self.caffeinate.toggle()
            self.stats.clear()
        else:
            return {"ok": False, "error": "bad_request"}
        return self._result(ok, error)
