# DSH Mobile 完整执行计划

架构决策见 [ADR 0005](docs/adr/0005-vps-endpoint-tunnel-first-app-only.md) 以及未被取代的 ADR 0001–0004、[CONTEXT.md](CONTEXT.md)。本文是**唯一执行总表**：产品范围、现场约束、目标形态、工作包顺序、验收。不要另开一套架构讨论。

维护者测试端点切换的操作细节见 [docs/ops-lab-custom-cutover.md](docs/ops-lab-custom-cutover.md)（第 0 包已完成）。

---

## 1. 产品

Android Capacitor APK。用户扫 Host 二维码配对后，在手机上使用自己的 DSH：会话、插件、官方窄屏布局。APK 是唯一 Product Client。

不是浏览器壳，不是项目运营的公共中继，不是第二个 DSH。Host 仍是用户自己的机器；手机只连那一台 Active Host。

发布形态：

- 零配置默认：Host 自己的 Cloudflare Quick Tunnel（各用户各走各的，项目零带宽）。
- 推荐稳定：Host 自托管 Custom Endpoint（文档里的 Docker 配方）。
- 维护者自己：`https://pair.noirbright.top` 只服务 `~/.dsh-lab` / 3082，永不写进 APK 默认值。

---

## 2. 现场环境（写死，禁止弄反）

| 角色 | 入口 | 家目录 | 用途 |
|---|---|---|---|
| DSH 源码开发 / 日常桌面 | `dsh-web.service` → `127.0.0.1:3080` → `dsh.noirbright.top` 与 `dshweb.noirbright.top` | 默认 `~/.dsh` | **冻结面**。改 DSH 源码、官方 UI。禁止 pairing，禁止占用 `43169`，禁止为了 app 重启 |
| dshapp 窄屏恢复面 | 同一 `3080`，静态壳在 VPS `dsh-mobile-web` 卷 → `dshapp.noirbright.top` | 不另起 DSH | 只改 `@dsh-mobile/ui-layout-mobile` 与 mobile-web 静态壳，见 [ops-dshapp-without-restarting-web.md](docs/ops-dshapp-without-restarting-web.md) |
| dsh-mobile 全部测试 | `dsh-lab.service` → `127.0.0.1:3082` + Gateway `43169` → `pair.noirbright.top` | `~/.dsh-lab` | APK 配对、连接、回归 |
| 海外 VPS | `ssh vps`（直连 `58022`） | RackNerd | 第 6 包自托管第二实例，国内不当主路径 |

`~/.dsh-web` 不是当前 systemd 家目录。`~/.dsh/mobile/public-endpoint.json` 与 3082 无关。改 dshapp 不得重启 `dsh-web.service`。

第 0 包已完成（2026-08-19）：lab YAML + overlay 为 `custom` / `https://pair.noirbright.top`，cloudflared 已停，公网 well-known 与 lab Host Identity 一致。真机 Endpoint Refresh 仍待做。

---

## 3. 目标形态（用户看得见的）

### 3.1 首次启动

APK 内置壳、字体、样式、`@dsh-mobile/ui-layout-mobile`。无 Host Profile 时只打开相机扫码，不拉网、不白屏等 Host。

### 3.2 配对

扫 v4 Public Endpoint offer。Native vault 存密钥和 device token。同一 Host Identity 更新已有 Profile，不复制。多设备共用一个端点（每设备独立房间，滥用上限 256）。

### 3.3 连接（Automatic）

立即走配置端点上的加密 Tunnel。WebRTC 直连可在短窗口内并行，同网抢赢才切过去；窗口结束仍在隧道，会话中途不迁移。路径在 UI 上可见。Direct Only / Tunnel Only 保留。

心跳按国内低延迟链路标定，普通抖动不得判死。

### 3.4 冷启动与素材

壳和移动布局永远来自 APK。Host 官方插件 bundle 按内容哈希缓存在设备上：

1. 有缓存：立刻用缓存画 UI（零等待下载）。
2. 后台对比 Host revision，只拉变更。
3. 稳态启动隧道上只有会话帧。

禁止把 Host 插件烤死进 APK（会和 Host 版本漂移）。禁止经隧道传图片/文件/网页静态资源。

### 3.5 重连

断线、切网、从后台回来：在**现有壳**上重连并补水，禁止 `location.reload()` 整页白屏。凭证在 vault 里，token 未撤销就不用重扫。Quick 域名变了才走 Endpoint Refresh。Vault 瞬时读失败不得删 Profile。

### 3.6 安全

每条路径都做 QR Host 公钥锚定的 NaCl 握手。端点只见密文和帧长。Gateway 只回环，永不暴露 DSH `:3080`。

---

## 4. 现在差什么（相对目标）

| 能力 | 现状 | 目标 |
|---|---|---|
| 维护者稳定端点 | 3082 已 custom | 真机 Refresh 一次即可 |
| Automatic | 隧道优先并与 Direct 竞速 | 真机确认 CGNAT 不再白等直连 |
| 心跳 | 20s / 15s / 3 次 | 长会话浸泡 |
| Vault 失败 | 瞬时读错误不再删 Profile | 真机 Keystore 抖动回归 |
| 浏览器客户端 | Gateway 不再吐 HTML 壳；QR 只给 APK | 真机确认无浏览器配对入口 |
| 冷启动 | 插件按 id+rev 缓存；boot roster 按 Host 缓存 | APK 断网先见壳（待真机） |
| 重连 | 切 Host / 策略 / 视口 / Endpoint Refresh 均壳内重连 | 真机长会话与杀进程再开 |
| Quick 提供者 | 可配置 command/args，cloudflared 默认 | 文档里给 natapp/frp 样例即可 |
| 自托管配方 | `deploy/self-host` Compose（Caddy+frps） | 干净机器拉起；不写进 APK |

---

## 5. 工作包

状态：包 0 运维完成（差真机 Refresh）；包 1–6 代码完成。Automatic Direct 宽限、冷启动读 boot cache、remount 不拆隧道、去掉 Host `/mobile` 预览与 browser shell 已落地。包 4 真机断网冷启动与包 7 真机矩阵仍须操作者/真机。`BrowserCredentialVault` 仅测试与非 native 壳使用，不随 Gateway 分发。

每包结束：相关测试和 typecheck 绿。包内不扩散到下一包。

### 包 0 — 维护者端点（已完成，差真机）

lab 切 custom。剩余：真机扫 3082 `/pair/ui` 的 Endpoint Refresh，确认 Tunnel 路径和 token 重连。

### 包 1 — 连接策略与心跳

改 `packages/e2e-tunnel`：

- `connectionAttempts('automatic')` 变为 `['tunnel', …]`；直连不作为隧道前置条件。
- Automatic 可并行探测直连，宽限期结束仍以隧道为准，不中途切换（同网直连若在宽限内先完成，才采用直连）。
- 重标定 `HeartbeatController` 默认值。
- 更新 `connection-policy` / `connection-manager` / client 测试。

### 包 2 — 凭证健壮性

改 `apps/mobile-web/src/profile-connection.ts`：vault **抛错**不得 `repository.remove`。仅 `read` 返回确定缺失才允许清 Profile（并须可回归测试）。扫描新码覆盖「密钥确定不存在」的旧 Profile 仍允许。

### 包 3 — 去掉浏览器 Product Client

删 Gateway 静态 shell、`browserShellPath`、browser QR / `capabilities.browser`、`BrowserCredentialVault`、`package-browser-shell` 脚本及对应测试文档。`/pair/ui` 只留 Host 本机设置（QR 给 APK）。ARCH grep 证明无浏览器壳残留。

### 包 4 — 完整 App 冷启动与重连（素材 + 壳）

这是「完整 mobile 应用」的核心包。

1. APK 继续打包壳、字体、样式、移动布局；启动先画本地骨架，文案为「正在连接」而不是白屏等 bundle。
2. 增加按 `id + rev` / 内容哈希的插件缓存（Capacitor Preferences 或文件系统）。`localizePluginBundles`：缓存命中不经隧道；未命中才 `client.fetch`。
3. boot manifest 缓存最近一次成功副本，隧道未就绪也可先选布局。
4. 去掉 `main.ts` 里因切 Profile、改策略、断线、视口变化而 `location.reload()` 的路径；改为停隧道、换 Active Host、再 `injectBootManifestFromTunnel`（优先缓存）。
5. 重连：`TunnelManager` 在现有 WebView 里重建会话；心跳恢复后不重载文档。

测试：缓存命中零 fetch；rev 变更只拉那一条；vault 瞬时失败 Profile 仍在；切 Host 不 reload。

### 包 5 — 可插拔 Quick 提供者

`QuickTunnelController` 改为「任意能吐出 HTTPS+WSS URL 的命令/配置」。内置 cloudflared。natapp/cpolar/自建 frp 只走配置，不写进默认二进制依赖。

### 包 6 — 自托管端点栈

Docker Compose：Caddy 自动证书 + frps；Host 侧 frpc 样例和指南。维护者可在 `vps-aliyun` 与海外 `vps` 各起一套给朋友同事（每实例约 50 并发活跃预算）。禁止写进 APK。海外 `ssh vps` 已直连可用。本包可与包 4 并行，但不得改客户端默认端点。

### 包 7 — 验收矩阵

- 真机 LTE/5G 与家里 Wi-Fi，经 `pair.noirbright.top`。
- 隧道 / Caddy / lab 重启后 token 重连，不重配对。
- Tunnel Only / Direct Only。
- 冷启动：断网先看到壳；联网后只补会话/变更 bundle。
- 长会话心跳不误杀。
- APK assemble。
- 干净机器用 Compose 拉起自托管栈。
- grep：无浏览器壳、无维护者域名默认值、无「先直连再隧道」的 Automatic。

---

## 6. 顺序与依赖

```text
包0 真机 Refresh ──┐
包1 连接策略 ────────┼─→ 包4 冷启动/重连/缓存 ──→ 包7 验收
包2 凭证 ────────────┘              ↑
包3 去浏览器 ───────────────────────┘
包5 可插拔 Quick ──→ 可与包4 并行，须在包7 前
包6 Compose/双 VPS ─→ 可与包4 并行，须在包7 前
```

先做 1+2（小、决定连接和凭证），再 3（删面），再 4（完整 App 体验）。5/6 不挡 1–3。没有 4 不算完整应用。

---

## 7. 明确不做

- 项目运营的多租户公共 relay。
- 多端点 Host Profile（一只 Profile 仍一个 URL）。
- 把 `pair.noirbright.top` 写进 APK。
- 在 3080 上做 mobile 验收或给 3080 挂 pairing。
- 隧道传图、传文件、传网页素材。
- 浏览器 PWA 作为产品。

---

## 8. 完成定义

仓库测试与 typecheck 绿；debug APK 可装；真机经 lab Custom Endpoint 完成：配对或 Refresh、隧道会话、杀进程再开不白等直连、二次冷启动不重下未变插件、断线重连不整页刷新。维护者域名只出现在 `~/.dsh-lab` 和运维文档，不出现在客户端默认配置。
