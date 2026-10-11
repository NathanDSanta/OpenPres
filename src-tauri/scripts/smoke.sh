#!/usr/bin/env bash
# Manual end-to-end check. Start the app first (cargo tauri dev), then:
#   ./scripts/smoke.sh [port]
set -euo pipefail
PORT="${1:-8787}"
BASE="http://127.0.0.1:${PORT}"
j() { curl -sS -H 'Content-Type: application/json' "$@"; echo; }

echo "== health";            j "$BASE/health"
echo "== refresh devices";   j -X POST "$BASE/devices/refresh"
echo "== video devices";     j "$BASE/devices/video"
echo "== audio devices";     j "$BASE/devices/audio"
echo "== displays";          j "$BASE/displays"
echo "== create screen";     j -X POST "$BASE/screens" -d '{"name":"Main","kind":"audience","width":1920,"height":1080}'
echo "== screens";           j "$BASE/screens"
echo "== audio routing";     j "$BASE/audio/routing"
echo "== add channel";       j -X POST "$BASE/audio/routing/channels" -d '{"index":0,"source_device":"mock","source_channel":0,"label":"Pastor","gain_db":0,"muted":false}'
echo "== create library";    j -X POST "$BASE/libraries" -d '{"name":"Songs"}'
echo "== themes";            j "$BASE/themes"
echo "== presenter state";   j "$BASE/presenter/state"
echo "smoke test finished"
