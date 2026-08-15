#!/usr/bin/env bash
# Runs ON the VPS: build, run, and wire dsh-relay behind Caddy /relay*.
#
# Caddy gotcha: /etc/caddy/Caddyfile is a single-file bind mount. Replacing
# the host file (mv/sed -i) changes its inode and the container keeps reading
# the old one. So: patch the host file for restarts, then deliver the runtime
# config with docker cp + reload from an in-container path.
set -euo pipefail
cd /root/dsh-relay

docker build -t dsh-relay:0.1.0 .
docker rm -f dsh-relay 2>/dev/null || true
docker run -d --name dsh-relay --network vps-net --restart unless-stopped dsh-relay:0.1.0
sleep 1
docker logs --tail 3 dsh-relay
docker exec dsh-relay wget -qO- http://localhost:8787/healthz && echo " (in-container)"

CADDYFILE=/root/infodigest/deploy/vps/Caddyfile
[ -f "$CADDYFILE.dsh-relay-bak" ] || cp "$CADDYFILE" "$CADDYFILE.dsh-relay-bak"
if ! grep -q 'dsh-relay' "$CADDYFILE"; then
  LINE=$(grep -n '# Default response to make it obvious' "$CADDYFILE" | head -1 | cut -d: -f1)
  { head -n $((LINE-1)) "$CADDYFILE"; cat /root/dsh-relay/caddy-block.txt; tail -n +$LINE "$CADDYFILE"; } > "$CADDYFILE.new"
  cat "$CADDYFILE.new" > "$CADDYFILE" && rm "$CADDYFILE.new"   # in-place: keep inode
  echo "Caddyfile patched at line $LINE"
fi
docker cp "$CADDYFILE" caddy:/tmp/Caddyfile.dsh-relay
docker exec caddy caddy reload --config /tmp/Caddyfile.dsh-relay --adapter caddyfile 2>&1 | tail -1
sleep 1
echo -n "via-caddy: "; curl -sk --resolve noirbright.top:443:127.0.0.1 https://noirbright.top/relay/healthz; echo
