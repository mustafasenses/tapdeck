#!/bin/zsh
# Double-click to start Tapdeck. Close this window (or press Ctrl+C) to stop it.
cd "${0:A:h}" || exit 1
exec /usr/bin/python3 server.py "$@"
