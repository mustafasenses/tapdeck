"""Now playing: browser tabs reported by the extension, media keys as fallback."""

import threading
import time

from .keyboard import Keyboard


class MediaHub:
    """Tracks what browser tabs report as playing and routes media commands.

    Each tab frame with media sends a heartbeat (~1/s) through the extension.
    Commands go to the most relevant tab through a long-poll the extension
    keeps open. If no extension is active, play/next/previous become system
    media key presses.
    """

    FRESH = 3.0    # a heartbeat newer than this means the source is live
    KEEP = 150.0   # forget sources silent for longer (closed/throttled tabs)
    KEY_FOR = {"toggle": Keyboard.PLAY, "next": Keyboard.NEXT, "prev": Keyboard.PREVIOUS}

    def __init__(self, keys):
        self.keys = keys
        self.cond = threading.Condition()
        self.sources = {}
        self.queue = []
        self.last_beat = 0.0
        self.waiter = 0

    def update(self, key, state):
        now = time.time()
        with self.cond:
            src = self.sources.get(key) or {"first": now, "played": 0.0}
            src["state"], src["seen"] = state, now
            if state.get("playing"):
                src["played"] = now
            self.sources[key] = src
            self.last_beat = now

    def remove(self, key=None, tab=None):
        with self.cond:
            for k in list(self.sources):
                if k == key or (tab is not None and k.split(":")[0] == str(tab)):
                    del self.sources[k]

    def _current(self):
        now = time.time()
        self.sources = {k: s for k, s in self.sources.items() if now - s["seen"] < self.KEEP}
        live = [(k, s) for k, s in self.sources.items()
                if s["state"].get("playing") and now - s["seen"] < self.FRESH]
        pool = live or list(self.sources.items())
        if not pool:
            return None
        return max(pool, key=lambda kv: (kv[1]["played"], kv[1]["first"]))

    def status(self):
        with self.cond:
            cur = self._current()
        if not cur:
            return {"source": "keys", "keys": self.keys.trusted()}
        _, src = cur
        st, now = src["state"], time.time()
        playing = bool(st.get("playing")) and now - src["seen"] < self.FRESH
        position = float(st.get("position") or 0)
        if playing:
            position += (now - src["seen"]) * float(st.get("rate") or 1)
        duration = float(st.get("duration") or 0)
        return {
            "source": "ext",
            "title": st.get("title") or "",
            "artist": st.get("artist") or "",
            "album": st.get("album") or "",
            "artwork": st.get("artwork") or "",
            "site": st.get("site") or "",
            "duration": duration,
            "position": min(position, duration) if duration else position,
            "playing": playing,
            "canSeek": bool(st.get("canSeek")),
            "keys": self.keys.trusted(),
        }

    def command(self, cmd, value=None):
        """Returns (ok, error_code)."""
        with self.cond:
            cur = self._current()
            # The extension's worker is surely alive if a heartbeat just arrived.
            if cur and time.time() - self.last_beat < self.FRESH:
                self.queue.append({"key": cur[0], "cmd": cmd, "value": value})
                self.cond.notify_all()
                return True, None
        return self.fallback(cmd)

    def fallback(self, cmd):
        key = self.KEY_FOR.get(cmd)
        if key is None:
            return False, "unsupported"
        if not self.keys.trusted():
            return False, "accessibility"
        return self.keys.media(key), None

    def wait(self, timeout=20.0):
        """Long-poll for queued commands. A newer poll supersedes older ones,
        so a poll left behind by a restarted extension worker can't swallow
        commands."""
        end = time.time() + timeout
        with self.cond:
            self.waiter += 1
            me = self.waiter
            self.cond.notify_all()
            while not self.queue and self.waiter == me:
                remaining = end - time.time()
                if remaining <= 0:
                    break
                self.cond.wait(remaining)
            if self.waiter != me:
                return []
            out, self.queue = self.queue, []
            return out
