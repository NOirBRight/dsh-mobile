# 插件解耦审计（设备连接页重排同期）

审计对象：`dsh-mobile`（壳 + ui-layout-mobile + pairing）与 `dsh-codex-sidebar`。官方 Core 不在本轮改动面。结论按耦合稳定性分层；脆弱层记录加固前后对比。

## 稳定层

这些面不依赖官方 CSS-module 哈希或未文档化 DOM 文案，官方升级时预期继续工作。

| 面 | 为什么稳 |
|---|---|
| `@dsh-mobile/e2e-tunnel` | 零官方 UI 依赖；offer / DataChannel / Host Gateway 自有协议 |
| Cordis Host 服务与 slot 注册 | pairing / sidebar / usage-monitor 走 `settings.section`、`shell.overlay` 等具名 slot；缺 slot 时插件不加载而非白屏 |
| `__DSH_BOOT__` 清单 | 官方嵌入契约；移动端只替换 root layout 一行 |
| Theme token | `--dsw-alias-*` / `--ds-font-family`；官方 CSS 自用，属中稳定 |
| 设备切换 | vault `deviceToken` 重建 offer，不扫码；与 Host UI 无关 |
| 后台连接保护 | Capacitor 前台服务；默认关，逻辑不依赖 Host DOM |

## 软兼容

会降级，但不阻断配对与会话。

| 面 | 行为 |
|---|---|
| 官方 layout revision 漂移 | 横幅「Host 布局版本有更新」，仍挂窄屏布局 |
| 窄屏 slot 契约缺失 | 回退官方 root，横幅「已回退到官方布局」 |
| 窄屏 layout 加载/注册抛错 | 回退官方 root，横幅「窄屏布局加载失败」；把失败时的 official `rev` 写入 `presentation.mobileLayoutFailedRev`，后续 boot 跳过窄屏直到 Host `rev` 变化 |
| 宽屏 | 恒官方 root，不加载 mobile layout |
| 会话增强 `compatible` | boot 常量保留；本轮只删设备页上的死 UI，不拆管线 |

## 脆弱层：本轮加固

### H1 锚点集中 + 失效可见（`dsh-mobile`）

**加固前：** `tunnel.ts` 直接查 `nav[aria-label="导航抽屉"]` / New session 文案；`installProfileAction` 扫「设置/Settings」；`MobileFrame` / `ComposerAttach` 各写一份 aria 正则。缺失时徽章、设备入口、抽屉关闭静默失效。

**加固后：**

- 壳侧解析器集中在 `apps/mobile-web/src/anchors.ts`：自家 DOM 优先（`[data-mobile-session-title]` 等），官方 aria/文案只作兜底。
- 布局侧标签契约集中在 `packages/ui-layout-mobile/src/client/chrome-anchors.ts`（New session、composer 发送/停止）；`MobileFrame` 关抽屉与 `composer-attach` 共用。
- boot 后 `inspectChromeAnchors()`：缺锚点 `console.warn` 一条；设备连接页设置区显示「部分界面增强不可用（Host UI 有变更）」。

**nav-icon：** 官方 `settings.section` 注册项只有 `name` / `id` / `order` / `label` / `locale` / `inject`，**没有 icon 字段**。`plugins/pairing`、独立 `dsh-mobile-pairing`、`dsh-usage-monitor` 仍用 DOM patch 换齿轮；找不到对应 nav 按钮时保持静默，不报错。

### H2 sidebar 去 CSS hash（`dsh-codex-sidebar` → `v0.3.7`）

**加固前：** `css.ts` 用 `[class$="_frame"]`、`[class*="centerCol"]`、`[class*="detailsCol"]` 匹配官方 CSS-module 哈希。

**加固后：** 运行时在 frame 上打 `data-dcs-details` / `data-dcs-header`（overlay 前一兄弟 = details 列，再前一列里的 `header`）；CSS 只选自有标记与 `data-dcs-pin` / `data-dcs-open`。保留 `[data-side="details"] { display: none }`（官方拖动手柄，官方 CSS 自用）。class-hash 子串选择器清零。

### H3 去除 prompt 劫持（`dsh-codex-sidebar`）

**加固前：** `#wrapPrompt` 替换官方 `binding.session.prompt`，发送瞬间拼批注摘要、stage、发后清芯片。

**加固后：** 批注增删即 `sidebar/stage-annotations`（`replacePending`）；Host `agent/inbox/inserted` 绑定后清空暂存；`agent/pre-step` 证据注入不变。人类可见性只靠 `annotation-chips`。不再改 `session.prompt`。

已知行为变化：消息正文不再含内联批注摘要；即时 stage 后，下一条进入该会话的用户消息（含其他设备）会带走批注。

剩余运行时 patch：`workspaces.openPath` 一处（feature-detect，失效仅路径打开退化）。

### H4 mobile layout boot rescue（`dsh-mobile`）

**加固前：** `ui-layout-mobile` 加载或 slot 注册抛错会让 `bootDshShell` 失败，窄屏白屏。

**加固后：** catch 后用 `fallbackOfficial` 再 boot；失败 `rev` 写入 profile `presentation.mobileLayoutFailedRev`；Host `rev` 变化时清标记重试。

## 本轮不动的耦合（记入 backlog）

| 面 | 说明 |
|---|---|
| sidebar `data-tool` 工具统计 | 官方 transcript 属性；官方 e2e 同用，相对稳 |
| `data-chat-flow-*` 批注芯片 | 同上，装饰器挂官方消息行 |
| 会话增强 boot 管线 | `compatible` 常量与 hydration 适配器仍在；只删了设备页 UI |
| `MobileFrame.module.css` 的 `[class*="headerActions"]` 等 | 另立计划（StatsLine / 顶栏自组装） |
| 模型 Picker / plan-review 自组装 | 已论证可行，不在本轮 |

## 验收面

- `dsh-mobile` / `dsh-codex-sidebar`：`pnpm test`；sidebar 在 3082 验 pin/toggle/header 与批注全流程后 tag `v0.3.7`。
- 移动端随本轮 APK：单设备列表不裁底、扫码 icon、点行切换、后台保护沉底且默认关、锚点体检可见降级。
- 3080 promote 不在本轮。
