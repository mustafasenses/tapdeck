"""Installed apps and their icons."""

import os
import plistlib
import re

from .config import CACHE_DIR
from .shell import run


# Candidates for the default Apps page, in order; the first 10 installed win.
DEFAULT_APPS = [
    "/Applications/Arc.app",
    "/Applications/Google Chrome.app",
    "/Applications/Safari.app",
    "/System/Applications/Safari.app",
    "/Applications/Firefox.app",
    "/System/Library/CoreServices/Finder.app",
    "/Applications/Visual Studio Code.app",
    "/Applications/Cursor.app",
    "/Applications/WebStorm.app",
    "/Applications/Rider.app",
    "/Applications/IntelliJ IDEA.app",
    "/System/Applications/Utilities/Terminal.app",
    "/Applications/iTerm.app",
    "/Applications/GitKraken.app",
    "/Applications/OrbStack.app",
    "/Applications/Docker.app",
    "/Applications/Notion.app",
    "/Applications/Claude.app",
    "/Applications/Spotify.app",
    "/Applications/WhatsApp.app",
    "/Applications/Telegram.app",
    "/Applications/Discord.app",
    "/Applications/Slack.app",
    "/System/Applications/Notes.app",
    "/System/Applications/Calendar.app",
    "/System/Applications/Mail.app",
    "/System/Applications/System Settings.app",
]

APP_DIRS = [
    "/Applications",
    "/Applications/Utilities",
    "/System/Applications",
    "/System/Applications/Utilities",
    os.path.expanduser("~/Applications"),
]


def app_name(path):
    return os.path.basename(path.rstrip("/"))[:-4]


def installed_apps():
    seen, apps = set(), []
    for d in APP_DIRS + ["/System/Library/CoreServices/Finder.app"]:
        entries = [os.path.basename(d)] if d.endswith(".app") else (
            os.listdir(d) if os.path.isdir(d) else [])
        base = os.path.dirname(d) if d.endswith(".app") else d
        for name in entries:
            if name.endswith(".app") and name not in seen:
                seen.add(name)
                apps.append({"name": name[:-4], "path": os.path.join(base, name)})
    return sorted(apps, key=lambda a: a["name"].lower())


def app_icon(path):
    """PNG icon bytes for an .app, converted from its .icns and cached."""
    if not path.endswith(".app") or not os.path.isdir(path):
        return None
    out = os.path.join(CACHE_DIR, "icons", re.sub(r"[^\w.-]", "_", path.strip("/")) + ".png")
    if not os.path.exists(out):
        try:
            with open(os.path.join(path, "Contents", "Info.plist"), "rb") as f:
                name = plistlib.load(f).get("CFBundleIconFile")
        except (OSError, plistlib.InvalidFileException):
            return None
        if not name:
            return None
        if not name.endswith(".icns"):
            name += ".icns"
        icns = os.path.join(path, "Contents", "Resources", name)
        if not os.path.exists(icns):
            return None
        os.makedirs(os.path.dirname(out), exist_ok=True)
        if run(["sips", "-s", "format", "png", "-Z", "128", icns, "--out", out], 15) is None:
            return None
    with open(out, "rb") as f:
        return f.read()
