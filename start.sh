#!/bin/bash
cd "$(dirname "$0")"

NODE_BIN="${NODE_BIN:-$(command -v node)}"
if [ -z "$NODE_BIN" ]; then
  echo "Node.js binary not found in PATH"
  exit 1
fi

# Kill anything on the required ports
kill -9 $(lsof -i :8080 -t 2>/dev/null) 2>/dev/null
kill -9 $(lsof -i :5174 -t 2>/dev/null) 2>/dev/null
sleep 1

# API server — nohup + disown so it survives any session reset
# TZ pinned to Asia/Kolkata so the "today" boundary for daily email limits
# is always IST midnight, regardless of where the server is deployed.
DATABASE_URL="postgresql://postgres@localhost/leadfinder?sslmode=disable" \
SESSION_SECRET="99625454ed5adc6b073639d22a6f295a414a1dada70872c68124edc4072841bd" \
NODE_ENV="development" PORT="8080" TZ="Asia/Kolkata" \
nohup "$NODE_BIN" --enable-source-maps \
  "$(pwd)/artifacts/api-server/dist/index.mjs" \
  >> /tmp/leadfinder-api.log 2>&1 &
disown $!

# Frontend server — nohup + disown
nohup "$NODE_BIN" \
  "$(pwd)/serve-frontend.js" \
  >> /tmp/leadfinder-frontend.log 2>&1 &
disown $!

sleep 2
echo "LeadFinder running → http://localhost:5174"
