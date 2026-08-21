# 外部执行：把 3082 测试环境切到 `pair.noirbright.top`

架构决策见 [ADR 0005](adr/0005-vps-endpoint-tunnel-first-app-only.md)，波次总表见 [PLAN.md](../PLAN.md)。本文只写 **PLAN 第 2 波在本机上的运维切换**，给不熟悉现场的执行者。不要在 3080 上做 mobile 验收。

## 环境职责（以本文件为准）

| 角色 | 进程 / unit | 家目录 | 端口 | 公网入口 | 允许做什么 |
|---|---|---|---|---|---|
| DSH 代码开发 | `dsh-web.service` | 默认 `~/.dsh`（unit 未设 `DSH_HOME`） | `127.0.0.1:3080` | `dsh.noirbright.top` ← `dsh-vps-tunnel.service`（VPS `31421`） | 改 DSH 源码、日常桌面。**禁止**挂 pairing、**禁止**占用 `43169` |
| dsh-mobile 测试 | `dsh-lab.service`（`DSH_HOME=~/.dsh-lab`） | `~/.dsh-lab` | `127.0.0.1:3082` + Gateway `127.0.0.1:43169` | `pair.noirbright.top` ← `dsh-gateway-vps-tunnel.service`（VPS `31422`） | **全部** APK 配对、连接、回归 |

`~/.dsh-web` 不是当前 systemd 在用的家目录，不要往里面写 pairing。`~/.dsh/mobile/public-endpoint.json` 是开发家目录上的旧 overlay，与 3082 无关。

当前（2026-08-19）现场：`pair.noirbright.top` 已经打到 lab 的 `43169`（身份 `_NzNO…5430`，与 `~/.dsh-lab` keypair 一致）。缺口是 lab 插件仍是 `endpointMode: quick`，`/pair/status` 广告的还是 `*.trycloudflare.com`。

## 禁止

- 不要改 `dsh-web.service` 的 `ExecStart`、不要给 3080 加 `@dsh-mobile/pairing`。
- 不要把 `gatewayPort` 改成 `0`，不要把 43169 绑到 3080。
- 不要动阿里云 Caddy 的 `dsh.noirbright.top` / `dshweb.noirbright.top` 站点（开发恢复面）。改 `dshapp` 的纪律见 [ops-dshapp-without-restarting-web.md](ops-dshapp-without-restarting-web.md)。
- 不要在本波次改客户端连接策略 / 去浏览器 / 缓存（那是 PLAN 3–8 波）。
- 不要把 `pair.noirbright.top` 写进 APK 默认值（ADR 0005：维护者端点永非产品默认）。

## 目标状态

1. `~/.dsh-lab/profiles/web/cordis.patch.yml` 里 pairing 为 `endpointMode: custom`，`customEndpointUrl: https://pair.noirbright.top`，`dshPort: 3082`，`gatewayPort: 43169`。
2. `systemctl --user restart dsh-lab.service` 后 **不再启动 cloudflared**；`curl http://127.0.0.1:3082/pair/status` 的 `endpoint.url` 为 `https://pair.noirbright.top`，`endpointMode` 为 `custom`。
3. `curl https://pair.noirbright.top/.well-known/dsh-mobile` 的 `hostIdentity` 与 3082 `/pair/status` 一致。
4. `dsh-gateway-vps-tunnel.service` 保持 `Restart=always`，**不要** `BindsTo=dsh-lab.service`（Gateway 短暂重启时隧道应自愈）。可选：加 `After=dsh-lab.service`。
5. 真机（LTE/5G）扫 **3082 设置页** 的 QR，连上后 UI 显示 Tunnel，心跳多轮不误杀；重启 lab / 重启 gateway 隧道后用原 device token 重连，不重新配对。
6. 抽查 3080：仍无 pairing 路由（`/pair/status` 不是 JSON endpoint 状态）；`ss -tlnp` 里 `43169` 仍只属于 lab 的 node。

## 步骤

1. 记录切前基线：`systemctl --user status dsh-web dsh-lab dsh-vps-tunnel dsh-gateway-vps-tunnel`；两套 `ss`；`curl` 3082 `/pair/status` 与公网 well-known。
2. 只改 `~/.dsh-lab/profiles/web/cordis.patch.yml` 的 `dsh-mobile-pairing.config`：`endpointMode: custom`，`customEndpointUrl: https://pair.noirbright.top`。其余字段保持。保存前 custom 检查会打 `/.well-known/dsh-mobile` 和 `/signal/check`；若隧道断着会失败——先确认 `dsh-gateway-vps-tunnel` 与 `43169` 在听。
3. `systemctl --user restart dsh-lab.service`。确认无 cloudflared 子进程（不要杀 3080）。
4. 跑上面「目标状态」3–6。设置页在 lab：`http://127.0.0.1:3082/pair/ui`（若路由不同，以插件实际为准，只在 3082 找）。
5. 真机配对。若手机仍持有旧 Quick 域名 Profile：走 Endpoint Refresh（同一 Host Identity），不要当成新 Host 再扫一遍，除非身份确实不同。
6. 把切后的 `/pair/status`、well-known、`ss`、unit 状态贴回报告。不要提交 `~/.dsh-lab` 或 systemd drop-in 以外的应用代码，除非检查失败必须修插件配置校验。

## 失败时

- 公网 502：先看 `43169` 是否在听、gateway 隧道是否 active，不要去重启 3080。
- `/pair/status` 仍是 quick：lab 没吃到 YAML，或 overlay 写到了错误 Home。只查 `~/.dsh-lab`。
- 身份不一致：公网打到了别的进程。用 `ss -tlnp | grep 43169` 确认 pid 的 `DSH_HOME` 必须是 `~/.dsh-lab`。
