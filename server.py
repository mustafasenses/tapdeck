#!/usr/bin/env python3
"""Start Tapdeck.

    python3 server.py              run until you close the window or press Ctrl+C
    python3 server.py --open       also open the button editor
    python3 server.py --make-app   build Tapdeck.app for the Dock
    python3 server.py --install    start at login instead (launchd)
    python3 server.py --uninstall  undo --install

The code lives in the tapdeck/ package.
"""

from tapdeck.cli import main

if __name__ == "__main__":
    main()
