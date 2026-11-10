"""Build Tapdeck.app: a Dock app that starts the server and stops it on Quit.

It's a stay-open AppleScript applet: opening it starts `server.py` in the
background, clicking its Dock icon again opens the button editor, and
quitting it (⌘Q, or Quit in the Dock menu) stops the server.
"""

import os
import plistlib
import shlex
import shutil
import subprocess
import tempfile

from .config import ROOT, load_config
from .icon import make_icon

APP_PATH = os.path.join(ROOT, "Tapdeck.app")

APPLET = """
property serverPID : missing value

-- Opening the app starts Tapdeck, or takes over one that is already
-- running (e.g. started from Terminal) so it can be stopped from here.
on run
	set existing to my runningServer()
	if existing is not "" then
		set serverPID to existing
		my showMenu()
	else
		my startServer()
	end if
end run

-- Clicking the Dock icon: the menu while running, start again if stopped.
on reopen
	if my isRunning() then
		my showMenu()
	else
		my startServer()
	end if
end reopen

on startServer()
	-- Only the server goes to the background, with every stream redirected:
	-- otherwise do shell script waits for it and the app stops responding.
	set serverPID to do shell script "cd __ROOT__ || exit 1; mkdir -p .cache; /usr/bin/python3 server.py > .cache/tapdeck.log 2>&1 < /dev/null & echo $!"
	delay 1.5
	if my isRunning() then
		display notification "Click the Dock icon to edit buttons or stop it." with title "Tapdeck is running"
	else
		set serverPID to missing value
		display alert "Tapdeck couldn't start" message "Another app may be using port __PORT__. Details are in .cache/tapdeck.log in the Tapdeck folder." as critical
		tell me to quit
	end if
end startServer

on showMenu()
	activate
	set choice to button returned of (display dialog "Tapdeck is running. Your phone can connect now." buttons {"Stop Tapdeck", "Connect Phone", "Edit Buttons"} default button "Edit Buttons" with title "Tapdeck" with icon (path to resource "applet.icns"))
	if choice is "Edit Buttons" then
		open location "http://127.0.0.1:__PORT__/edit"
	else if choice is "Connect Phone" then
		open location "http://127.0.0.1:__PORT__/connect"
	else
		tell me to quit
	end if
end showMenu

-- The pid of the Tapdeck server on our port, or "" (nothing there, or
-- another program that isn't ours).
on runningServer()
	try
		set pid to first paragraph of (do shell script "/usr/sbin/lsof -ti tcp:__PORT__ -sTCP:LISTEN")
		do shell script "/bin/ps -o command= -p " & pid & " | /usr/bin/grep -q server.py"
		return pid
	on error
		return ""
	end try
end runningServer

on isRunning()
	if serverPID is missing value then return false
	try
		do shell script "kill -0 " & serverPID
		return true
	on error
		return false
	end try
end isRunning

-- If the server stops some other way (its Terminal window was closed, it
-- crashed), offer to start it again here instead of leaving it off.
on idle
	if serverPID is not missing value and not my isRunning() then
		set serverPID to missing value
		activate
		set choice to button returned of (display dialog "Tapdeck stopped. Start it again?" buttons {"Quit", "Start Tapdeck"} default button "Start Tapdeck" with title "Tapdeck" with icon (path to resource "applet.icns"))
		if choice is "Start Tapdeck" then
			my startServer()
		else
			tell me to quit
		end if
	end if
	return 5
end idle

-- Quitting the app (⌘Q, the Dock menu or Stop Tapdeck) stops the server.
on quit
	if my isRunning() then
		try
			do shell script "kill " & serverPID
		end try
	end if
	continue quit
end quit
"""


def _applescript_string(text):
    return text.replace("\\", "\\\\").replace('"', '\\"')


def _write_icns(path, workdir):
    big = os.path.join(workdir, "icon_1024.png")
    with open(big, "wb") as f:
        f.write(make_icon(1024, mac=True))
    iconset = os.path.join(workdir, "Tapdeck.iconset")
    os.makedirs(iconset)
    for size in (16, 32, 128, 256, 512):
        for scale in (1, 2):
            name = "icon_%dx%d%s.png" % (size, size, "@2x" if scale == 2 else "")
            px = str(size * scale)
            subprocess.run(["sips", "-z", px, px, big, "--out", os.path.join(iconset, name)],
                           check=True, capture_output=True)
    subprocess.run(["iconutil", "-c", "icns", iconset, "-o", path], check=True, capture_output=True)


def make_app():
    port = str(load_config()["port"])
    script = (APPLET.replace("__PORT__", port)
              .replace("__ROOT__", _applescript_string(shlex.quote(ROOT))))
    print("\n  Building Tapdeck.app…")
    with tempfile.TemporaryDirectory() as tmp:
        source = os.path.join(tmp, "Tapdeck.applescript")
        with open(source, "w", encoding="utf-8") as f:
            f.write(script)
        if os.path.exists(APP_PATH):
            shutil.rmtree(APP_PATH)
        subprocess.run(["osacompile", "-s", "-o", APP_PATH, source], check=True)

        resources = os.path.join(APP_PATH, "Contents", "Resources")
        _write_icns(os.path.join(resources, "applet.icns"), tmp)

    # Newer applets also carry an asset-catalog icon, which would win over ours.
    assets = os.path.join(resources, "Assets.car")
    if os.path.exists(assets):
        os.remove(assets)
    info_path = os.path.join(APP_PATH, "Contents", "Info.plist")
    with open(info_path, "rb") as f:
        info = plistlib.load(f)
    info.pop("CFBundleIconName", None)
    info.update(CFBundleIconFile="applet", CFBundleName="Tapdeck",
                CFBundleIdentifier="com.tapdeck.launcher")
    with open(info_path, "wb") as f:
        plistlib.dump(info, f)

    # Editing the bundle broke osacompile's signature; sign it again (ad hoc).
    subprocess.run(["codesign", "--force", "--deep", "--sign", "-", APP_PATH],
                   check=True, capture_output=True)
    os.utime(APP_PATH)  # nudge Finder and the Dock to pick up the new icon

    print("  Done: %s\n" % APP_PATH)
    print("  Drag it to your Dock. Click it to start Tapdeck, click again to edit")
    print("  buttons, Quit (⌘Q or the Dock menu) to stop.\n")
    print("  macOS will ask once for Accessibility access, this time for \"Tapdeck\".")
    print("  Rebuilt the app? macOS ties the permission to each build, so remove the")
    print("  old Tapdeck entry first:  tccutil reset Accessibility com.tapdeck.launcher\n")
