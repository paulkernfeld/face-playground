#!/bin/bash
# Mindfulness gate — start Vite, run mindfulness check, clean up.
# Usage: ./check-mindfulness.sh [duration_seconds]

DURATION="${1:-10}"
PORT=5198

npx vite --port "$PORT" &
VITE_PID=$!

# Wait for server to be ready
echo "Waiting for Vite on port $PORT..."
while ! lsof -ti :"$PORT" > /dev/null 2>&1; do
  sleep 0.5
done
echo "Vite ready."

npx tsx scripts/mindfulness-gate.ts --port "$PORT" --duration "$DURATION"
EXIT_CODE=$?

kill "$VITE_PID" 2>/dev/null
wait "$VITE_PID" 2>/dev/null
exit "$EXIT_CODE"
