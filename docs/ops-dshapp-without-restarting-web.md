# 运维规则：冻结 dshweb，只改 dshapp 的官方窄屏布局

> 维护者个人恢复面的工作纪律，不是产品默认拓扑。产品规则仍以 [ADR 0004](adr/0004-responsive-layout-and-design-ownership.md)、[ADR 0005](adr/0005-vps-endpoint-tunnel-first-app-only.md)、[ADR 0006](adr/0006-regional-official-sealed-relay.md)、[CONTEXT.md](../CONTEXT.md) 为准。历史部署记录见 [dual-domain-deployment.md](dual-domain-deployment.md)。

dshweb 和 dshapp 共用一台 Host：`dsh-web.service` → `127.0.0.1:3080` → VPS `172.18.0.1:31421`。`dsh-vps-tunnel.service` 对 `dsh-web.service` 使用 `BindsTo`，重启 Host 会把两条公网入口一起掐断。因此迭代顺序写死为：**先保证 dshweb 正常且不重启，再改 dshapp。**

精确域名：`https://dshweb.noirbright.top`、`https://dshapp.noirbright.top`。`dsh-web.noirbright.top` / `dsh-app.noirbright.top` 不是现网主机名。`https://dsh.noirbright.top` 与 dshweb 同属冻结面。

## 1. 冻结面（本轮禁止碰）

| 对象 | 为什么冻 |
|---|---|
| `dsh-web.service` 的 ExecStart、环境、drop-in、PID | 这就是 dshweb 的进程；重启会带倒隧道 |
| `dsh-vps-tunnel.service` | 公网 `31421`；`BindsTo` 随 Host 生死 |
| `~/.dsh` 以及 3080 上的 web profile / 插件清单 | dshapp 的 `/plugins/@deepseek-ai/*` 和 `/api/*` 都从这里来 |
| Caddy 站点 `dsh.noirbright.top`、`dshweb.noirbright.top` | 官方 UI 入口；不要为 app 改 Host 改写或 trusted-host |
| 3080 上的 pairing、`43170` | 当前 daily Pair 的有意配置；public Pair 不得改挂到 lab |
| lab `:3082` + `43169` | 独立测试面，可选择自己的 Custom Endpoint 或 Official Relay |
| 官方 UI 模块源码（对话、侧栏、设置、theme tokens） | app 消费 Host 现成模块，不在 3080 上另开一套 |

冻结验收（改 app 前后各记一次，必须相同）：

```bash
systemctl --user show dsh-web.service -p MainPID,ActiveState,NRestarts
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3080/
```

MainPID 变了 = 本轮失败，先把 web 拉回，再谈 app。

## 2. 可改面（只动这些）

| 对象 | 作用 |
|---|---|
| `packages/ui-layout-mobile` | 窄屏根布局：官方 `root` slot 的空间重组 |
| `apps/mobile-web` 的 boot/manifest 适配 | 从 Host roster 里换根布局、丢掉 HMR；不是第二套功能 UI |
| VPS 卷 `/var/lib/docker/volumes/dsh-mobile-web/_data` | dshapp 的静态壳和 mobile layout bundle。`app.noirbright.top` 只 301 到 dshapp，不再做 Host 桥 |

默认发布路径：本地 `npm run build` → rsync/scp 进该卷（`index.html` + `assets/` + `plugins/@dsh-mobile/`）→ 浏览器硬刷新 dshapp。静态 Web 容器直接读卷上的文件，**不要**重启 `dsh-web`、**不要** `docker restart caddy`、**不要**重启 `dsh-mobile-web`（除非静态没被卷进来）。

Caddy 的 dshapp / `app.noirbright.top` 站点块只有在改路由或上游请求头时才动。必须重载时用 `docker exec caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile`，禁止 `docker restart caddy`，更不要重启 `dsh-web.service`。dshapp 代理的 `Host`、`X-Forwarded-Host`、`Origin`、`Referer` 必须全部使用 Host 回环值：`127.0.0.1:3080`、`127.0.0.1:3080`、`http://127.0.0.1:3080`、`http://127.0.0.1:3080/`；公共域名头会触发 Host 的 403。当前需保持的扩展 RPC 路由包括 `/api/*`、`/plugins/*`、`/codex/*`、`/codex-sidebar/*`、`/dsh-market/*`、`/external-agents/*`、`/grok/*`、`/llm-assistant/*`、`/ollama-cloud/*`、`/usage-monitor/*`。`GET /?token=` 必须反代到 Host 根路径做 launch-token 换 cookie；静态壳若直接吃掉这个查询，alpha.1 以后会掉进扫码页而不是手机布局。`/plugins/@dsh-mobile/*` 走静态卷，不要打到 Host。

需要破坏性试验时走 `dsh-lab.service` `:3082` / 独立 Custom Endpoint 或 Official Relay，或 dshapp 已有的 `/__prototype/*` → `31423`。当前 `pair.noirbright.top` 有意连接 daily 3080，不要把 lab 试验切到该域名。

## 3. App 修改规则（官方 UI 的 layout 调整）

dshapp 不是独立产品 UI。它是同一份 Host 官方模块在窄屏上的重组，契约见 ADR 0004 与 `packages/ui-layout-mobile/README.md`。

1. **只换根布局，不换功能。** 会话、侧栏、设置、工作区、composer 仍是 Host 的 `@deepseek-ai/dsh-client-ui-*`。禁止在 mobile 包里重写这些叶子，禁止再做一个平行功能面。
2. **宽屏继续官方桌面。** 视口 ≥ 696px（官方 `56 + 640`）必须挂 `@deepseek-ai/dsh-client-ui-layout`。mobile layout 只在窄屏替换 `root`。禁止把 dshapp 做成“永远手机壳”。
3. **slot 契约逐字对齐上游。** `sidebar` / `conversation` / `details` / `shell.overlay` 的 kind/scope、`ctx.layout` 三方法、ThemePresenter 不得自行发明。升级上游时 diff 官方 `ui-layout` 的 `src/client/index.ts`。
4. **视觉属于官方 theme。** 颜色、字体、圆角、阴影、边框、动效用官方 semantic token / primitive。没有 token 就加到官方所有者，不要在 mobile CSS 里抄一份字面量设计系统。
5. **窄屏只改空间语义：** 单栏、顶栏、sidebar → overlay drawer（展开宽默认 280px，owner 拿到实测宽度）、details → 全屏 sheet、safe-area。抽屉打开时 `collapsed: false`，不要让官方侧栏掉进桌面轨道模式。
6. **禁止深挖官方 DOM。** 不准靠 `main header`、generated CSS-module class 去搬 token 统计、turn 元数据、composer。信息优先级/截断可以变，完整信息必须仍能点开或通过无障碍文本拿到。
7. **layout 包保持纯 UI。** 不准引入 Capacitor、vault、扫码、配对、Host 协议。那些属于 `apps/mobile-web` 壳；本轮若只改外观，壳也不要顺手改连接策略。
8. **Host boot roster 是只读的。** dshapp 客户端把 desktop layout 条目换成本地 mobile bundle，并去掉 `@deepseek-ai/dsh-client-hmr`。不准为了 app 去改 3080 吐出的官方 HTML/插件列表。

## 4. 发布后检查

- `dsh-web.service` MainPID 与改前相同，`NRestarts` 未增加。
- dshweb 仍是官方三栏/自适应桌面布局，roster 含 `@deepseek-ai/dsh-client-ui-layout`、不含 `@dsh-mobile/ui-layout-mobile`。
- 窄屏 dshapp 根为 `@dsh-mobile/ui-layout-mobile`，会话等内容仍来自官方模块；拉宽超过 696px 回到官方 layout。
- 静态 `index.html` 已指向新 hashed 资源；layout `client.js` 已更新。

## 5. dshapp 手机设置操作

设置继续使用 Host 官方设置模块，不另造一套 dock 设置状态。手机上按以下路径操作：

1. 打开 `https://dshapp.noirbright.top`，点左上角菜单打开官方侧栏，再点侧栏里的设置入口。
2. 设置类别在面板顶部横向排列；左右滑动可到达“模型”“LLM 供应商”“用量”“Agent 预设”“插件市场”等页面。
3. 修改完成后点设置面板右上角的“关闭”按钮；这是官方关闭动作，不要用浏览器后退代替。
4. “用量”和“插件市场”需要对应 RPC 路由可用；若页面显示加载失败，先检查本节的 loopback `header_up`，再检查 `/usage-monitor/usage/query` 或 `/dsh-market/registry` 是否返回 200。
5. 发布静态 layout 后执行浏览器硬刷新；不需要、也不允许为了 dshapp 重启 `dsh-web.service`。
