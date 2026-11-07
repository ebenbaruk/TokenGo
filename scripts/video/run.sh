#!/usr/bin/env bash
# Vidéo de démo de bout en bout : build → serveur de tournage (8807, base jetable) → tournage Playwright → montage ffmpeg.
# Sorties : docs-assets/video/{tokengo-demo.mp4, tokengo-demo-portrait.mp4, thumbnail.png, catch-loop.mp4, catch-loop.gif}
# Bruts et intermédiaires : var/video/ (ignoré par git).
set -euo pipefail
cd "$(dirname "$0")/../.."
command -v ffmpeg > /dev/null || { echo "ffmpeg is required" >&2; exit 1; }
[[ -n "${VIDEO_SKIP_BUILD:-}" ]] || npm run -s build
trap 'scripts/video/server.sh stop' EXIT
scripts/video/server.sh start
node scripts/video/record.ts "$@"
scripts/video/server.sh stop
node scripts/video/compose.ts
ls -lh docs-assets/video/
