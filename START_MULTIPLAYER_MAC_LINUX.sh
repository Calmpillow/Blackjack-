#!/bin/sh
cd "$(dirname "$0")/server" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20 or newer is required."
  exit 1
fi
(node server.js) &
pid=$!
sleep 1
if command -v open >/dev/null 2>&1; then open http://localhost:8787/
elif command -v xdg-open >/dev/null 2>&1; then xdg-open http://localhost:8787/
fi
wait "$pid"
