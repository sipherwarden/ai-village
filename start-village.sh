#!/usr/bin/env sh
# Starts the AI Village hub (or opens it if it is already running). macOS and Linux.
cd "$(dirname "$0")" || exit 1
exec node scripts/start.mjs "$@"
