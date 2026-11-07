#!/usr/bin/env bash
# Serveur de tournage (port 8807, base jetable var/video.db, sans chaîne ni vrais crédits).
# Usage : scripts/video/server.sh start|stop
set -euo pipefail
cd "$(dirname "$0")/../.."
PORT=8807
PIDFILE=var/video/server.pid
case "${1:-start}" in
  start)
    mkdir -p var/video
    "$0" stop || true
    rm -f var/video.db var/video.db-*
    PORT=$PORT PUBLIC_URL=http://localhost:$PORT DB_PATH=var/video.db FEATURE_CHAIN=0 FEATURE_REAL_CREDITS=0 \
      DEMO_TOKEN=video ADMIN_TOKEN=video NODE_ENV=development OVERPASS_URLS=off \
      nohup node apps/server/src/index.ts > var/video/server.log 2>&1 &
    echo $! > "$PIDFILE"
    for _ in $(seq 1 60); do curl -sf "http://localhost:$PORT/healthz" > /dev/null && exit 0; sleep 0.5; done
    echo "server did not start" >&2; exit 1 ;;
  stop)
    if [[ -f $PIDFILE ]]; then kill "$(cat "$PIDFILE")" 2> /dev/null || true; rm -f "$PIDFILE"; fi
    # au cas où il a été lancé à la main : ce qui écoute sur le port de tournage
    for p in $(ss -ltnpH "sport = :$PORT" 2> /dev/null | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u); do kill "$p" 2> /dev/null || true; done
    sleep 0.5
    rm -f var/video.db var/video.db-* ;;
esac
