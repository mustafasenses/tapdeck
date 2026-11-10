"""System state: CPU, memory, battery, volume, language and keep-awake."""

import ctypes
import os
import re
import subprocess

from .shell import osa, run


class CpuMeter:
    """System-wide CPU usage from host_statistics() tick deltas."""

    def __init__(self):
        self.lib = ctypes.CDLL("/usr/lib/libSystem.B.dylib")
        self.lib.mach_host_self.restype = ctypes.c_uint32
        self.lib.host_statistics.argtypes = [
            ctypes.c_uint32, ctypes.c_int, ctypes.c_void_p, ctypes.POINTER(ctypes.c_uint32)]
        self.host = self.lib.mach_host_self()
        self.prev = self._ticks()
        self.value = 0.0

    def _ticks(self):
        info = (ctypes.c_uint32 * 4)()  # user, system, idle, nice
        count = ctypes.c_uint32(4)
        self.lib.host_statistics(self.host, 3, info, ctypes.byref(count))  # HOST_CPU_LOAD_INFO
        return list(info)

    def sample(self):
        cur = self._ticks()
        delta = [(c - p) & 0xFFFFFFFF for c, p in zip(cur, self.prev)]
        self.prev = cur
        total = sum(delta)
        if total:
            self.value = 100.0 * (total - delta[2]) / total
        return round(self.value)

MEM_TOTAL = int(run(["sysctl", "-n", "hw.memsize"]) or 0)


def memory():
    out = run(["vm_stat"]) or ""

    def pages(label):
        m = re.search(r"%s:\s+(\d+)" % re.escape(label), out)
        return int(m.group(1)) if m else 0

    m = re.search(r"page size of (\d+)", out)
    page = int(m.group(1)) if m else 16384
    # Roughly Activity Monitor's "Memory Used": app + wired + compressed.
    app = pages("Anonymous pages") - pages("Pages purgeable")
    used = (app + pages("Pages wired down") + pages("Pages occupied by compressor")) * page
    if not MEM_TOTAL:
        return None
    return {
        "percent": round(100 * used / MEM_TOTAL),
        "usedGB": round(used / 2**30, 1),
        "totalGB": round(MEM_TOTAL / 2**30),
    }


def battery():
    out = run(["pmset", "-g", "batt"]) or ""
    m = re.search(r"(\d+)%;\s*([^;]+);", out)
    if not m:
        return None  # desktop Mac
    state = m.group(2).strip()
    return {
        "percent": int(m.group(1)),
        "charging": state in ("charging", "finishing charge"),
        "plugged": "AC Power" in out,
    }


def get_volume():
    out = osa('set v to get volume settings\n'
              'return (output volume of v as text) & "|" & (output muted of v as text)')
    if not out or "|" not in out:
        return None, False
    vol, muted = out.split("|", 1)
    return (int(vol) if vol.isdigit() else None), muted == "true"


def screenshot_dir():
    loc = run(["defaults", "read", "com.apple.screencapture", "location"])
    loc = os.path.expanduser(loc) if loc else ""
    return loc if loc and os.path.isdir(loc) else os.path.expanduser("~/Desktop")


def mac_speaks_turkish():
    langs = run(["defaults", "read", "-g", "AppleLanguages"]) or ""
    return bool(re.search(r'"?tr\b|-TR\b', langs))


class Caffeinate:
    """Keeps the Mac (and its display) awake while enabled."""

    def __init__(self):
        self.proc = None

    @property
    def on(self):
        return self.proc is not None and self.proc.poll() is None

    def toggle(self):
        if self.on:
            self.proc.terminate()
            self.proc = None
        else:
            # -w: exits on its own if this server dies.
            self.proc = subprocess.Popen(["caffeinate", "-di", "-w", str(os.getpid())])
        return self.on
