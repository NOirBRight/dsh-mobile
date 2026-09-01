# 插件解耦状态

审计对象是 `dsh-mobile`（壳、`ui-layout-mobile` 与 Pairing）和 `dsh-codex-sidebar`。官方 Core 不属于移动端修改面；实现按稳定性和降级行为分类。

## 稳定层

这些面使用自有协议、具名 slot、自有标记或公开 boot 清单，不依赖官方 CSS-module 哈希或未文档化 DOM 文案。

| 面 | 行为 |
|---|---|
| `@dsh-mobile/e2e-tunnel` | 不依赖官方 UI；提供 offer、DataChannel、Host Gateway 和 sealed transport |
| Cordis Host 服务与 slot 注册 | Pairing、sidebar、usage-monitor 使用 `settings.section`、`shell.overlay` 等具名 slot；缺少 slot 时插件不加载 |
| `__DSH_BOOT__` 清单 | 使用官方嵌入清单；移动端只替换 root layout 条目 |
| Theme token | 使用 `--dsw-alias-*` 与 `--ds-font-family` |
| 设备切换 | 使用 vault `deviceToken` 重建 offer，不依赖扫码或 Host UI |
| 后台连接保护 | 使用 Capacitor 前台服务；默认关闭，不依赖 Host DOM |

## 软兼容

缺少可选的官方契约时，移动端保留会话功能并显示或记录对应降级状态。

| 面 | 行为 |
|---|---|
| 官方 layout revision 漂移 | 显示「Host 布局版本有更新」，继续使用窄屏布局 |
| 窄屏 slot 契约缺失 | 回退官方 root，并显示「已回退到官方布局」 |
| 窄屏 layout 加载或注册失败 | 回退官方 root，显示「窄屏布局加载失败」，记录失败的 official `rev` 到 `presentation.mobileLayoutFailedRev`；Host `rev` 变化后重试 |
| 宽屏 | 使用官方 root，不加载 mobile layout |
| 会话增强 `compatible` | 保留 boot 常量；设备页不渲染未使用的增强 UI |

## 运行时适配

### H1 锚点集中与失效可见

壳侧解析器集中在 `apps/mobile-web/src/anchors.ts`，优先使用 `[data-mobile-session-title]` 等自有 DOM 标记，并以官方 aria 或文案作为兜底。布局侧标签集中在 `packages/ui-layout-mobile/src/client/chrome-anchors.ts`，负责 New session、composer 发送与停止；`MobileFrame` 和 `composer-attach` 共用这些标签。boot 后的 `inspectChromeAnchors()` 对缺失锚点记录一条 warning，设备连接页显示「部分界面增强不可用（Host UI 有变更）」。

官方 `settings.section` 注册项没有 icon 字段。已发布的 `@dsh-mobile/pairing` 和 `dsh-usage-monitor` 使用 DOM Adapter 补充齿轮图标；找不到对应 nav 按钮时保持静默。

### H2 sidebar 选择器

运行时在 frame 上设置 `data-dcs-details` 和 `data-dcs-header`；CSS 使用这些自有标记及 `data-dcs-pin`、`data-dcs-open`。`[data-side="details"]` 仍用于隐藏官方拖动手柄，其他 CSS-module hash 子串选择器不参与布局。

### H3 批注提交

批注变更写入 `sidebar/stage-annotations`（`replacePending`）；Host 绑定 `agent/inbox/inserted` 后清空暂存，`agent/pre-step` 继续注入证据。人类可见性来自 `annotation-chips`，`binding.session.prompt` 不被修改。即时 stage 后，下一条进入会话的用户消息（包括其他设备发出的消息）携带暂存批注。

`workspaces.openPath` 使用 feature detection；不支持该能力时路径打开功能退化。

### H4 mobile layout boot

`ui-layout-mobile` 加载或 slot 注册失败时，`bootDshShell` 使用 `fallbackOfficial` 重新启动。失败的 official `rev` 写入 profile 的 `presentation.mobileLayoutFailedRev`；Host `rev` 变化后清除该标记并重试。

## 仍依赖官方 DOM 的面

| 面 | 依赖 |
|---|---|
| sidebar `data-tool` 工具统计 | 使用官方 transcript 属性和官方 e2e 约定 |
| `data-chat-flow-*` 批注芯片 | 装饰器挂在官方消息行上 |
| `MobileFrame.module.css` 的 `[class*="headerActions"]` 等 | 依赖官方顶栏 class；StatsLine 和顶栏自组装尚未独立 |
| 模型 Picker / plan-review | 由其 owning plugin 组装，不属于移动端 seam |

## 验收范围

`dsh-mobile` 和 `dsh-codex-sidebar` 运行各自的 `pnpm test`；sidebar 验证 3082 上的 pin、toggle、header 和批注流程。移动端验证单设备列表不裁底、扫码 icon、点行切换、默认关闭的后台保护、锚点降级提示，以及官方 checkout 的隔离构建。3080 promotion 不属于移动端验收范围。

验收证据见 [Issue #3 implementation evidence](../issue-3-implementation-evidence.md)。
