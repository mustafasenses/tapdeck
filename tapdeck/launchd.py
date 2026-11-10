"""Optional: start Tapdeck at login with a launchd agent."""

import os
import plistlib
import subprocess
import sys

from .config import ROOT


LAUNCH_LABEL = "com.tapdeck.server"
LAUNCH_PLIST = os.path.expanduser("~/Library/LaunchAgents/%s.plist" % LAUNCH_LABEL)
LOG_PATH = os.path.expanduser("~/Library/Logs/Tapdeck.log")


def install():
    """Run the server at login (and restart it if it crashes) via launchd."""
    uninstall(quiet=True)
    python = "/usr/bin/python3" if os.path.exists("/usr/bin/python3") else sys.executable
    plist = {
        "Label": LAUNCH_LABEL,
        "ProgramArguments": [python, os.path.join(ROOT, "server.py")],
        "WorkingDirectory": ROOT,
        "RunAtLoad": True,
        "KeepAlive": True,
        "ProcessType": "Interactive",
        "StandardOutPath": LOG_PATH,
        "StandardErrorPath": LOG_PATH,
    }
    os.makedirs(os.path.dirname(LAUNCH_PLIST), exist_ok=True)
    with open(LAUNCH_PLIST, "wb") as f:
        plistlib.dump(plist, f)
    r = subprocess.run(["launchctl", "bootstrap", "gui/%d" % os.getuid(), LAUNCH_PLIST],
                       capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit("launchctl failed: %s" % (r.stderr.strip() or r.returncode))
    print("\n  Tapdeck will now start automatically when you log in.")
    print("  Log:        %s" % LOG_PATH)
    print("  Uninstall:  python3 server.py --uninstall\n")
    print("  macOS may ask again for network and Accessibility access, this time for \"python3\".\n")


def uninstall(quiet=False):
    subprocess.run(["launchctl", "bootout", "gui/%d/%s" % (os.getuid(), LAUNCH_LABEL)],
                   capture_output=True)
    if os.path.exists(LAUNCH_PLIST):
        os.remove(LAUNCH_PLIST)
    if not quiet:
        print("\n  Tapdeck no longer starts at login.\n")
