"""Command line entry point: python3 server.py [--open | --make-app | --install | --uninstall]."""

import sys
from http.server import ThreadingHTTPServer

from .config import load_config
from .handler import Handler, phone_urls
from .launchd import install, uninstall
from .macapp import make_app
from .panel import Panel
from .shell import run


def main():
    if sys.platform != "darwin":
        sys.exit("Tapdeck only runs on macOS.")
    sys.stdout.reconfigure(line_buffering=True)
    if "--install" in sys.argv:
        return install()
    if "--uninstall" in sys.argv:
        return uninstall()
    if "--make-app" in sys.argv:
        return make_app()
    cfg = load_config()
    Handler.panel = Panel(cfg)

    ThreadingHTTPServer.daemon_threads = True
    ThreadingHTTPServer.allow_reuse_address = True
    try:
        server = ThreadingHTTPServer(("0.0.0.0", cfg["port"]), Handler)
    except OSError as e:
        sys.exit("Port %d is busy (%s). Is Tapdeck already running?" % (cfg["port"], e))

    url, alt = phone_urls(cfg)
    base = "http://127.0.0.1:%d" % cfg["port"]
    print("\n  Tapdeck is running.\n")
    print("  Edit buttons:  %s/edit" % base)
    print("  Connect phone: %s/connect\n" % base)
    print("  Phone URL:     %s" % url)
    print("  (or)           %s\n" % alt)
    if not Handler.panel.keys.trusted():
        print("  Shortcuts, typing and media keys need Accessibility permission —\n"
              "  macOS will ask now (System Settings → Privacy & Security → Accessibility).\n")
        Handler.panel.keys.request_access()
    if "--open" in sys.argv:
        run(["open", base + "/edit"])
    print("  Close this window or press Ctrl+C to stop.\n")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  Bye.")
    finally:
        server.server_close()
