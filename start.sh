#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"

NODE_BIN="${NODE_BIN:-$(command -v node)}"
if [ -z "$NODE_BIN" ]; then
  echo "Node.js binary not found in PATH"
  exit 1
fi

PYTHON_BIN="${PYTHON_BIN:-$(command -v python3)}"
if [ -z "$PYTHON_BIN" ]; then
  echo "python3 binary not found in PATH"
  exit 1
fi

PID_DIR="${PID_DIR:-/tmp/leadfinder-pids}"
mkdir -p "$PID_DIR"

# Kill anything on the required ports
for port in 8080 5174; do
  pids="$(lsof -ti :"$port" 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    kill -9 $pids 2>/dev/null || true
  fi
done
sleep 1

# Kill any stale processes whose pid files still exist
for pidfile in "$PID_DIR"/api.pid "$PID_DIR"/frontend.pid; do
  if [ -f "$pidfile" ]; then
    old_pid="$(cat "$pidfile" 2>/dev/null || true)"
    if [ -n "${old_pid:-}" ] && kill -0 "$old_pid" 2>/dev/null; then
      kill -9 "$old_pid" 2>/dev/null || true
    fi
    rm -f "$pidfile"
  fi
done

ROOT_DIR="$(pwd)"
export ROOT_DIR NODE_BIN PID_DIR

# Spawn fully detached child processes using Python so they survive
# independently of the shell session that launched them.
"$PYTHON_BIN" - <<'PY'
import os
import subprocess
from pathlib import Path

root = Path(os.environ["ROOT_DIR"])
node_bin = os.environ["NODE_BIN"]
pid_dir = Path(os.environ["PID_DIR"])

api_log = open("/tmp/leadfinder-api.log", "ab", buffering=0)
front_log = open("/tmp/leadfinder-frontend.log", "ab", buffering=0)

api_env = os.environ.copy()
api_env.update({
    "DATABASE_URL": "postgresql://postgres@localhost/leadfinder?sslmode=disable",
    "SESSION_SECRET": "99625454ed5adc6b073639d22a6f295a414a1dada70872c68124edc4072841bd",
    "NODE_ENV": "development",
    "PORT": "8080",
    "TZ": "Asia/Kolkata",
})

api_proc = subprocess.Popen(
    [node_bin, "--enable-source-maps", str(root / "artifacts/api-server/dist/index.mjs")],
    cwd=str(root),
    env=api_env,
    stdin=subprocess.DEVNULL,
    stdout=api_log,
    stderr=subprocess.STDOUT,
    start_new_session=True,
    close_fds=True,
)
(pid_dir / "api.pid").write_text(str(api_proc.pid))

front_proc = subprocess.Popen(
    [node_bin, str(root / "serve-frontend.js")],
    cwd=str(root),
    env=os.environ.copy(),
    stdin=subprocess.DEVNULL,
    stdout=front_log,
    stderr=subprocess.STDOUT,
    start_new_session=True,
    close_fds=True,
)
(pid_dir / "frontend.pid").write_text(str(front_proc.pid))
PY

sleep 2
echo "LeadFinder running → http://localhost:5174"
