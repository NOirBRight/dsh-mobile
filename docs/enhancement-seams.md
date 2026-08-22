# 增强功能与官方功能解耦盘点（2026-04-24）

目标：移动端增强不再以"上游工作树未提交补丁"的方式混在官方源码里，
官方升级（deepseek-harness 重新 checkout / pull）时移动端功能不丢、不坏。

现状：apps/mobile-web 的 Vite 构建直接编译上游 **源码**（vite.config.ts 的
`DSH_UPSTREAM` 默认指向同级 `dsh-wt-02` 目录），所以上游工作树里的任何
未提交修改都会打进 APK。当前上游（dsh-wt-02 @ 0.1.1-rc.1）携带以下移动端
驱动的改动：

## 一、混在上游工作树里的增强（需要解耦/上游化）

| # | 增强 | 触点 | 性质 | 建议去向 |
|---|------|------|------|----------|
| 1 | 冷启动恢复上次会话（startupRestoredSessionId + 合成列表行 + 首个基线校验） | `packages/client/runtime/src/client/sessions/service.ts`（约 70 行）、`sessions/manager.ts`（restoredSelection 入参） | 通用可靠性修复，非移动端特有 | **上游化**：给官方提 PR。Web 刷新页也受益。在此之前是本 repo 的最大未提交补丁 |
| 2 | 历史会话本地缓存（cache-first，localStorage `dsh-mobile:history:*`） | `packages/client/runtime/src/client/sessions/session.ts`（约 130 行）：构造函数水合、installWindow / loadOlder / resync / prompt 成功处写回 | 移动端特化（离线秒开），但实现长在官方 Session 内部 | **官方留接口**：上游导出一个会话窗口缓存的挂载点（如 SessionOptions.historyCache），移动端注册实现；当前把 `document.documentElement.dataset.dshSurface === 'mobile'` 作为开关写死在官方代码里是最脆弱的一环 |
| 3 | 子代理目录只在菜单打开时刷新（不再随 select/重连自动拉） | `manager.ts`（openCatalogs 门控）、`ui-subagent/SubagentHeaderLineage.tsx` | 通用性能修复 | **上游化**：行为更优，官方会要 |
| 4 | 顶栏"会话统计"文案（StatsLine 中文本地化等） | `ui-conversation/src/client/chat/StatsLine.tsx`、`locales.ts` | 另一条工作线的改动，非本移动端 | 与负责人确认归属；不要混进移动端补丁集 |

上游工作树里目前共 13 个文件改动（+391/-52），其中 1/2/3 是移动端补丁，
合计约 270 行；这是"官方一更新就丢"的风险面。

## 二、移动端自有代码里对官方结构的隐性依赖（需加契约/稳定锚点）

| # | 依赖 | 位置 | 风险 |
|---|------|------|------|
| 5 | 顶栏动作区顺序/紧凑文案：CSS 用 `[class*="headerActions"]`、`[class*="count"]` 等子串匹配官方 CSS-module 哈希类名 | `packages/ui-layout-mobile/src/client/MobileFrame.module.css` | 官方改类名/结构即静默失效（已发生过一次：display:contents 被同特异性后写规则击败） |
| 6 | "子代""命令"文案靠 `::after` content 注入 | 同上 | 官方改 DOM（span 包层变化）即失效，且无视觉回退 |
| 7 | 官方 DOM 几何（顶栏、抽屉、tab 顺序）断言 | `apps/mobile-web/test/fixtures/mobile-layout/fixture.tsx` + `mobile-layout.test.mjs` | 这是**好**的解耦：fixture 即契约。但 fixture 与真实上游组件的同步靠手工 |

建议：
- 向官方要稳定锚点（如 `data-slot="header-actions"`、官方导出的 count/label 类名），
  移动端 CSS 只绑锚点；锚点缺失时 mobile-layout 测试应**响亮失败**而不是静默跳过。
- 在 apps/mobile-web 增加一个"上游结构契约"测试：直接装载真实上游 CSS module
  （而非 fixture 副本），断言 headerActions / activitySlot / count 存在，官方升级时立即报警。

## 三、已完全解耦的部分（官方更新天然不影响）

- `apps/mobile-web/src/`：main.ts、host-session.ts、native-bridges.ts、tunnel.ts、
  profile-connection.ts——全部 App 专有，官方不感知。
- `packages/e2e-tunnel`、`packages/mobile-relay`：整套 P2P/WebRTC 隧道是我们自己的。
- `packages/ui-layout-mobile` 的组件代码（MobileFrame.tsx、ComposerAttach、
  theme-presenter 等）只依赖官方 slot/contract 接口，不靠源代码改动。

## 四、行动顺序建议

1. 立即做：把上游补丁（1/2/3）固化为**独立补丁文件**（`patches/` 或 fork 分支
   dsh-wt-02 的 feature 分支并定期 rebase），官方升级时按补丁重放，
   补丁里每个文件配对应测试——测试在就是补丁在。
2. 短期：向上游提交 1 和 3 的 PR（通用修复，最容易被接受）。
3. 中期：为 2 设计官方缓存挂载点接口，摆脱 dataset 开关。
4. 中期：为 5/6 向官方要稳定锚点；同时给 mobile-layout 测试加载真实上游 CSS。
5. 持续：官方升级 checklist——同步 dsh-wt-02 → 重放补丁 → 跑上游 runtime 测试
   + 移动端聚合测试 → 打 APK → 真机冷启动/切会话冒烟。
