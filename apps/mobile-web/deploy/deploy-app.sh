#!/usr/bin/env bash
# Build and deploy the mobile PWA to https://app.noirbright.top/
#
# VPS topology (see docs/deployment.md): Caddy (their container, vps-net)
# reverse-proxies app.noirbright.top to the dsh-mobile-web nginx container,
# which serves the docker volume dsh-mobile-web. The nginx container cannot
# see host paths, so the dist is staged at /root/dsh-mobile-web/dist and then
# copied into the volume; chmod fixes the 0600 modes rsync preserves from
# this machine's umask.
#
# The deploy also mirrors the profile's plugin bundles into dist/plugins:
# the client module loader fetches them with <script src> tags, which bypass
# the in-page fetch shim — they must exist on the VPS itself. Plugin code is
# static and public; only /api traffic needs the tunnel.
set -euo pipefail
cd "$(dirname "$0")/.."

npm run build

PROFILE_URL=${PROFILE_URL:-http://127.0.0.1:3090}
echo "mirroring plugin bundles from $PROFILE_URL ..."
rm -rf dist/plugins && mkdir -p dist/plugins
count=0
for u in $(curl -fs "$PROFILE_URL/" | grep -o '/plugins/[^"]*\.js' | sort -u); do
  path=${u%%\?*}
  mkdir -p "dist$(dirname "$path")"
  curl -fs "$PROFILE_URL$u" -o "dist$path"
  count=$((count + 1))
done
echo "mirrored $count plugin bundles"
[ "$count" -gt 30 ] || { echo "too few bundles mirrored — is the profile up?"; exit 1; }

rsync -az --delete -e "ssh -F $HOME/.ssh/config" dist/ vps-aliyun:/root/dsh-mobile-web/dist/
ssh -F "$HOME/.ssh/config" vps-aliyun 'docker run --rm -v dsh-mobile-web:/v -v /root/dsh-mobile-web/dist:/src:ro alpine sh -c "rm -rf /v/* && cp -r /src/* /v/ && chmod -R a+rX /v"'
echo "deployed: https://app.noirbright.top/"
