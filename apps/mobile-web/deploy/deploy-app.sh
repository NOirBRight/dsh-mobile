#!/usr/bin/env bash
# Build and deploy the mobile PWA to https://app.noirbright.top/
#
# VPS topology (see docs/deployment.md): Caddy (their container, vps-net)
# reverse-proxies app.noirbright.top to the dsh-mobile-web nginx container,
# which serves the docker volume dsh-mobile-web. The nginx container cannot
# see host paths, so the dist is staged at /root/dsh-mobile-web/dist and then
# copied into the volume; chmod fixes the 0600 modes rsync preserves from
# this machine's umask.
set -euo pipefail
cd "$(dirname "$0")/.."

npm run build
rsync -az --delete -e "ssh -F $HOME/.ssh/config" dist/ vps-aliyun:/root/dsh-mobile-web/dist/
ssh -F "$HOME/.ssh/config" vps-aliyun 'docker run --rm -v dsh-mobile-web:/v -v /root/dsh-mobile-web/dist:/src:ro alpine sh -c "rm -rf /v/* && cp -r /src/* /v/ && chmod -R a+rX /v"'
echo "deployed: https://app.noirbright.top/"
