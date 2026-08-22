#!/bin/sh
set -eu

# Self-host the official opaque Relay with Docker Compose.
# Set RELAY_HOST in .env before running this script.
cd "$(dirname "$0")"
[ -f .env ] || cp .env.example .env

host=$(awk -F= '/^RELAY_HOST=/{print $2}' .env)
[ -n "$host" ] && [ "$host" != relay.example.com ] || { echo 'Set RELAY_HOST in .env before deploying.' >&2; exit 2; }

docker compose up -d --build
docker compose exec -T caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
curl -fsS "https://$host/healthz"
printf '
Relay is healthy.
'
