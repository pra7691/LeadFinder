#!/bin/bash
cd "$(dirname "$0")"

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
nohup /Applications/Codex.app/Contents/Resources/node --enable-source-maps \
  "$(pwd)/artifacts/api-server/dist/index.mjs" \
  >> /tmp/leadfinder-api.log 2>&1 &
disown $!

# Frontend server — nohup + disown
nohup /Applications/Codex.app/Contents/Resources/node \
  "$(pwd)/serve-frontend.js" \
  >> /tmp/leadfinder-frontend.log 2>&1 &
disown $!

sleep 2
echo "LeadFinder running → http://localhost:5174"
