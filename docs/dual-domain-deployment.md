# 双域名生产部署记录

> **历史个人恢复记录，不是产品部署文档。** 以下维护者域名、VPS 与旧 v3 signaling 配置均不是 DSH Mobile 默认值或依赖，也不参与 Host-owned Public Endpoint、WebRTC Direct 或 Tunnel Fallback。当前产品部署以 [`deployment.md`](./deployment.md) 与 offer v4 协议为准；这些入口仅按要求保持在线。

部署时间：2026-08-16（UTC）

## 结果

- `https://dsh.noirbright.top`：保留原有 Caddy、Basic Auth、reverse SSH 和原版 DSH UI，作为已知可用的止血/回滚入口；除非人工再次确认，不再提前退役。
- `https://dshweb.noirbright.top`：Caddy Basic Auth 后反代到 reverse SSH listener `172.18.0.1:31421`，再到本机唯一的 `127.0.0.1:3080` DSH 进程。它持续展示上游原版 `@deepseek-ai/dsh-client-ui-layout`，不复制上游静态资源。
- `https://dshapp.noirbright.top`：Basic Auth 后由 VPS 静态 Nginx提供 Mobile Shell和 `@dsh-mobile/ui-layout-mobile`；裸 URL通过受保护的 `/__dsh_boot`、`/plugins/*`、`/api/*` 同源桥直接访问同一个 DSH。带新 `#offer` 的链接仍优先走 WebRTC配对路径。
- `wss://relay.noirbright.top`：继续只传递有界 SDP 信令。应用 HTTP/WebSocket在配对模式下由 NaCl会话封装后走 WebRTC `RTCDataChannel`；没有 TURN、数据中继回退或运行时 CDN。

`dshweb` 和 `dshapp` 的 Basic Auth 用户/哈希逐字复用旧站，未把凭据写入仓库。两个新域名的 Host桥均固定上游 `Host`、`X-Forwarded-Host`、`Origin` 和 `Referer` 为旧站身份，以兼容 DSH trusted-host栅栏；公网入口仍保持各自的新域名。

## 配对入口

日常 DSH profile 的 pairing 配置为：

```yaml
appUrl: https://dshapp.noirbright.top/
signalingUrl: wss://relay.noirbright.top
enableDirect: true
```

Host `GET /pair` 或 `GET /pair?format=svg` 生成：

```text
https://dshapp.noirbright.top/#offer=<base64url-v3-offer>
```

`offer` fragment不会发送给静态服务器。公共静态 Shell首次使用仍需要这个配对链接；本次维护者个人部署另外提供 Basic Auth保护的同源 Host桥，因此 `dshapp`裸域名也能直接启动。Android APK仍使用本地 bundle，不依赖该静态站。

## 发布内容

构建及校验：

```bash
npm test
npm run typecheck
npm run build
```

三条命令全部通过。发布后主要校验和：

```text
b54e44b768e7971a95daaf75eb0580afc0aa36c9a5c8750ecee9eaaab4d5bc07  index.html
5368d2c0f699390ec972f5d9e386d76ffd350264ba9eee7234d5f7437286a693  plugins/@dsh-mobile/ui-layout-mobile/client.js
```

VPS 静态卷：`/var/lib/docker/volumes/dsh-mobile-web/_data`。原有 `app.noirbright.top` 也指向同一容器，因此同步获得了本次静态构建。

## 验证记录

- 两个新域名均由 Let's Encrypt 签发且通过系统信任验证。
- `dshweb`：未认证 401；临时、随后删除的测试账号认证后 200；boot manifest 包含 desktop layout 且不含 mobile layout；`/api/events.mux` WebSocket upgrade 返回 101。旧 Basic Auth 哈希与最终新站配置比对一致。
- `dshapp`：未认证 HTML、`/__dsh_boot`和 `/api/*`均为 401；认证后 HTML、Host boot manifest、本地 mobile layout plugin和 `/api/host.listDirectory`均为 200。
- 干净 headless Chrome通过 Basic Auth从裸域名启动同源直连模式，boot manifest包含 `@dsh-mobile/ui-layout-mobile`且不含 desktop layout，页面渲染官方会话/工作区内容。
- `#offer`模式仍可完成 relay SDP → STUN-only WebRTC → `dsh-tunnel` DataChannel → NaCl handshake → tunneled manifest/plugin/WebSocket；offer fragment不会泄露到服务器。
- `dsh-web.service` 主 PID 在 pairing 配置热重载前后保持不变；没有启动第二个 DSH，也没有停止或重启 FlClash。

## 备份

VPS（权限 0700/0600）：

```text
/root/dsh-dual-domain-backups/20260816T071650Z/Caddyfile.before
/root/dsh-dual-domain-backups/20260816T071650Z/dns-before.json
/root/dsh-dual-domain-backups/20260816T071650Z/dns-added.txt
/root/dsh-dual-domain-backups/20260816T071650Z/mobile-static.before.tar.gz
/root/dsh-dual-domain-backups/20260816T071650Z/legacy-retirement.txt
```

Host profile：

```text
/home/noirbright/.dsh/profiles/web/cordis.patch.yml.backup-20260816T072807Z
```

## 完整回滚

以下命令在 VPS 执行。Caddyfile 是单文件 bind mount；使用重定向原地覆盖并重启容器，避免运行中的容器继续持有旧 inode。

```bash
set -euo pipefail
backup=/root/dsh-dual-domain-backups/20260816T071650Z
volume=/var/lib/docker/volumes/dsh-mobile-web/_data

# 恢复旧 Caddy 拓扑（重新启用 dsh，移除两个新站块）
cat "$backup/Caddyfile.before" > /root/infodigest/deploy/vps/Caddyfile
docker exec caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker restart caddy

# 恢复旧静态内容
sudo find "$volume" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
sudo tar -C "$volume" -xzf "$backup/mobile-static.before.tar.gz"

# 删除新 DNS；恢复旧 dsh A 记录
aliyun alidns DeleteDomainRecord --RecordId 2088887802023925760
aliyun alidns DeleteDomainRecord --RecordId 2088887806600270848
aliyun alidns AddDomainRecord \
  --DomainName noirbright.top --RR dsh --Type A \
  --Value 120.26.124.92 --TTL 600
```

Host pairing 配置回滚会由 DSH 热重载，不要重启或另起 DSH：

```bash
cat /home/noirbright/.dsh/profiles/web/cordis.patch.yml.backup-20260816T072807Z \
  > /home/noirbright/.dsh/profiles/web/cordis.patch.yml
```

回滚后至少复查 Caddy 语法、DNS、旧域名 401、静态首页，以及 `systemctl --user is-active dsh-vps-tunnel.service`。
