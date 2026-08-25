#!/bin/bash
# Double-click this file to launch GLOCKWORK in your browser, with MIDI support.
#
# Runs the production build on a local server (http://localhost is treated as a secure
# context, so the Web MIDI API works the same as it would on a real HTTPS site) and opens it
# in Chrome, which has the most reliable Web MIDI support of any browser.

set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

PORT=4173
URL="http://localhost:$PORT"

echo "========================================"
echo "  GLOCKWORK — Orff & Mallet Lab"
echo "========================================"
echo ""

if [ ! -d "node_modules" ]; then
  echo "First-time setup — installing dependencies (this only happens once)..."
  npm install
  echo ""
fi

if [ ! -d "dist" ]; then
  echo "Building the app (this only happens once, or after you update the source)..."
  npm run build
  echo ""
fi

# Free up the port if a previous run is still hanging around.
if lsof -ti:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Stopping a previous GLOCKWORK server still running on port $PORT..."
  lsof -ti:$PORT -sTCP:LISTEN | xargs kill >/dev/null 2>&1 || true
  sleep 1
fi

echo "Starting local server on $URL ..."
npm run preview -- --port $PORT --strictPort >/tmp/glockwork-server.log 2>&1 &
SERVER_PID=$!

trap 'echo ""; echo "Stopping GLOCKWORK server..."; kill $SERVER_PID 2>/dev/null; exit 0' INT TERM EXIT

# Wait for the server to actually respond before opening a browser tab.
READY=0
for i in $(seq 1 40); do
  if curl -sf "$URL" >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 0.5
done

if [ "$READY" -ne 1 ]; then
  echo ""
  echo "The server didn't start in time. Log output:"
  cat /tmp/glockwork-server.log
  exit 1
fi

echo ""
echo "Opening $URL"
echo ""
echo "For MIDI support, use Google Chrome or Microsoft Edge — Safari and Firefox"
echo "don't support the Web MIDI API yet."
echo ""
echo "Keep this window open while you play. Close it (or press Ctrl+C) to stop the server."
echo ""

if [ -d "/Applications/Google Chrome.app" ]; then
  open -a "Google Chrome" "$URL"
elif [ -d "/Applications/Microsoft Edge.app" ]; then
  open -a "Microsoft Edge" "$URL"
else
  open "$URL"
fi

wait $SERVER_PID
