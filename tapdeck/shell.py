"""Running commands, AppleScript and shell commands, and opening things."""

import os
import re
import subprocess
import threading


def run(cmd, timeout=5):
    """Run a command, return stripped stdout or None on failure."""
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return r.stdout.strip() if r.returncode == 0 else None


def osa(script, timeout=5):
    return run(["osascript", "-e", script], timeout)


def run_command(command):
    """Runs a shell command the way your terminal would (login + interactive
    zsh, so PATH, nvm, aliases work). Waits a few seconds for a result."""
    env = dict(os.environ, SHELL_SESSIONS_DISABLE="1")  # no "Saving session..." from Terminal's zshrc
    try:
        proc = subprocess.Popen(
            ["/bin/zsh", "-lic", command], cwd=os.path.expanduser("~"), env=env,
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, start_new_session=True)
    except OSError as e:
        return {"ok": False, "output": str(e)}
    try:
        out, _ = proc.communicate(timeout=8)
    except subprocess.TimeoutExpired:
        threading.Thread(target=proc.communicate, daemon=True).start()
        return {"ok": True, "running": True}
    lines = [l for l in (out or "").strip().splitlines() if l.strip()]
    return {"ok": proc.returncode == 0, "output": lines[-1][:160] if lines else ""}


def open_target(target):
    """Opens an app (path or name), a URL, or a file/folder."""
    target = os.path.expanduser(target.strip())
    if re.match(r"^[a-zA-Z][\w+.-]*://", target):
        return run(["open", target]) is not None
    if os.path.exists(target):
        return run(["open", target]) is not None
    return run(["open", "-a", target]) is not None
