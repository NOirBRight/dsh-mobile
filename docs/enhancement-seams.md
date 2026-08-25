# 官方 DSH 恢复与插件解耦计划

## 决策与目标状态

本项目只维护插件。官方 [`deepseek-ai/deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness) 是只读依赖；插件必须能在干净的官方 tag 上安装、降级和验收。缺失的 Interface、slot 或 RPC 以独立上游提案处理，在提案进入官方发布前，任何插件都不得依赖本地 DSH patch。

完成本计划后：

1. 官方 DSH checkout 恢复到 `dsh-v0.1.1-rc.2` / `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`，`git status --porcelain` 为空。
2. `dsh-composer-picker`、`dsh-external-agents` 以及 dsh-mobile 的三个活动插件只使用正式插件 seam。
3. 插件缺少官方能力时 fail-closed：能力关闭并给出可见说明，而不是要求 patched Core。
4. 通用改进可以独立向上游提 PR；插件只在包含该改进的官方版本发布后启用对应 Adapter。

## 执行前偏差基线

执行前，两个 DSH checkout 都位于官方 rc.2 commit：

| checkout | 当前偏差 | 用途 |
|---|---:|---|
| `/home/noirbright/Workstation/dsh-question-lab` | 18 files，+333/-34 | question/interactions 实验 worktree |
| `/home/noirbright/.local/opt/dsh-staging/dsh-v0.1.1-rc.2-b150a551b8d4` | 20 files，+372/-41 | 上述 18 files，加 plan-mode handoff sentinel |

执行前两处 `git diff --check` 都通过，但“补丁可应用”不等于“插件已解耦”。这些差异没有转成插件运行时 patch、fork 前置条件或发布资产。

### 偏差归类

| 改动集 | DSH 触点 | 正确归属 | 处理 |
|---|---|---|---|
| interaction replay fence | `client/connection` fixture、`client/runtime` Session、`host/apiproxy` mux/schema/tests | DSH 的 wire/runtime 一致性；不是插件 UI | 插件不模拟协议。作为通用上游提案单独提交；未发布前接受官方 rc.2 行为，插件不得宣称重连后 pending wait 权威同步。 |
| Plan Review execution-model child slot | `client/ui-user-questions` contract、panel、CSS、tests | picker 与 external-agents 两个插件之间的组合 seam | 删除对官方自定义 slot 的依赖；由拥有顶层 Plan 卡的插件声明 child slot，picker 只提供 Adapter。样式和提交顺序测试全部回到插件。 |
| external handoff sentinel | `plan/plan-mode` 的 `EXTERNAL_PLAN_HANDOFF_SENTINEL`、`{ delegated: true }` tool result | 通用的 Plan disposition 语义目前没有公开 seam | 不用 magic custom answer 伪装协议。当前 patch 还没有调用 `exec.concludeTurn()`，不能保证源 Agent 本轮终止。先在官方 rc.2 上关闭“交给外部 Worker”决策；保留普通 External Agents 工具、设置与 Job 能力。另提通用上游 Interface。 |
| Plan Review 插件 UI | `ui-user-questions` 的 Panel TSX、contract 与 tests | 提供 Plan 卡的 client plugin，或通用 upstream preparation seam | 当前先迁回插件自有 `conversation.composer` owner 和 child Adapter，不覆盖官方 Question owner。 |
| 移动 footer / safe-area CSS | `PlanReviewPanel.module.css`、`QuestionComposer.module.css` 的窄屏布局 | 官方 Question UI 的通用响应式正确性 | 作为独立上游 PR；插件不得靠本地 CSS patch。插件自有 Plan 卡继续自带样式。 |

## 稳定分工

### 官方 DSH

- 拥有 Session、pending interaction、question/approval 生命周期及 wire schema。
- 拥有 Plan Mode 状态转换和 `exit_plan_mode` 的工具语义。
- 提供正式的 Cordis、client boot、slot、settings、RPC/event 与 Jobs Interface。
- 不承载某个本地插件专用的 sentinel、文案、CSS 或 child slot。

### dsh-external-agents

- 拥有 Worker catalog、探测、普通 delegation 的外部进程 Adapter 与 Jobs 接入；delegated Plan 的 prepare/commit 只在官方 seam 发布后恢复。
- 通过已有 `conversation.composer` chain（priority `-6`）拥有自己的 Plan 路由卡。
- 声明插件自有 `external-agents.plan-review.continue-in-dsh` child slot，并提供无 picker 时的降级 select。
- 没有官方 delegated disposition 时隐藏或禁用外部 Plan handoff；不得发送私有 sentinel。

### dsh-composer-picker

- 拥有模型目录、Picker UI、选择提交与样式。
- 与 external-agents 双装时，只向 `external-agents.plan-review.continue-in-dsh` 注册 Adapter。
- 单装时恢复插件自有的 `conversation.composer` Plan Review 卡（priority `-5`），在回答 Approve 前提交 execution model。
- 删除对 patched `@deepseek-ai/dsh-client-ui-user-questions/client` 导出、`conversation.composer.plan-review.execution-model` 和 `setApprovalPreparation` 的依赖。

### dsh-mobile 活动插件

- `plugins/pairing`：Host Gateway、配对、设置 UI 与 sealed transport；发布源同步到独立 `dsh-mobile-pairing`。
- `packages/interaction-operations`：输入归一化与 presentation-only intents；不做业务 mutation。
- `packages/ui-layout-mobile`：窄屏空间布局；不拥有官方 leaf feature UI，契约失败时回退官方 root。

## 执行阶段

### P0 — 冻结 Core 并固定证据（已开始）

- [x] 所有活动插件项目的 `AGENTS.md` 写入“官方 DSH 只读”规则。
- [x] Workstation 共享规则改为插件优先，只有用户明确发起独立上游贡献任务时才允许隔离 worktree。
- [x] 记录两个 checkout 的 commit、文件数、行数与改动集归属。
- [x] P4 前没有扩展两处 DSH diff；只读用于对照。

完成标准：任何新产品需求首先落到插件目录；缺 seam 时产生上游提案或显式降级，不再产生新的 Core diff。

### P1 — 抽回插件拥有的实现（已完成）

1. `dsh-composer-picker`
   - 恢复插件自有的 Plan Review chain owner，覆盖“picker 单装”。
   - 保留 external-agents 的 plugin-owned child Adapter，覆盖“双装”。
   - 删除 official child-slot Adapter、对应类型导入及 generated artifact。
2. `dsh-external-agents`
   - 保留 top-level Plan card、plugin-owned child slot、普通 Worker delegation 与 Jobs；旧 prepare/commit 入口只返回 fail-closed 错误。
   - 删除 sentinel 常量及 custom-answer 路径。
   - 在 capability 不存在时 fail-closed：外部 Plan handoff 不可选，普通 Worker delegation 保持可用。
   - 可另做 agent-scoped `exit_plan_mode` 全量 tool shadow spike；只有官方工具注册确实支持确定性覆盖、且插件完整保持 approve/revise 行为、调用 `exec.concludeTurn()` 并通过 stock parity tests 时才可用。它不是默认路线，需单独 ADR 接受整工具接管的维护成本。
3. 测试
   - picker：单装 approve 前先提交模型；提交失败时不回答 question。
   - 双装：picker 通过 external-agents child slot 注册；无官方自定义 slot。
   - external-agents：无 delegated disposition 时不 prepare、不 commit、不启动 Worker。

完成标准：在未修改的 rc.2 类型与运行时上，两个插件均能 build/test；代码和 bundle 中不再出现官方自定义 slot 或 sentinel。

### P2 — 只向上游提交通用 seam

#### Proposal A：Plan disposition Interface

提案必须是通用 Interface，而不是某个插件的 sentinel：

- 能原子地把当前 Plan Review 解析为 `approved | revise | delegated`；
- `delegated` 让源 Agent 保持 Plan Mode，并通过等价于 `exec.concludeTurn()` 的正式语义终止本轮，不触发本地执行；
- 由 Host/Plan controller 产生可验证 receipt，client 不能用任意 custom 文本伪造；
- 支持幂等重试、事件回放、断线恢复和可审计的 Job/worker reference；
- tool schema、SDK binding、Host/client tests 同步更新。

在包含此 Interface 的官方 tag 发布前，external Plan handoff 保持关闭。发布后新增一个版本化 Adapter，不保留 sentinel 兼容层。

#### Proposal B：interaction snapshot fence

将 `session/interactions-synced` 作为独立的通用可靠性提案评审：明确 replay 顺序、每 Session fence、旧 client/Host 兼容策略及 schema 版本。该提案不作为任何插件发布的阻塞依赖。

#### Proposal C：通用 Plan preparation 与响应式修复

如果官方希望第三方在保留 stock Plan panel 时参与 Approve 前准备，提案应提供通用 preparation provider Interface（ready、commit、cleanup、错误回显），而不是 execution-model 专用 slot。移动 footer、按钮排列与 safe-area 是另一份纯响应式 PR，必须与插件功能分开评审。插件在两项发布前仍使用自有 composer owner 或接受 stock UI，不依赖本地 Core diff。

不向上游申请 Plan Review execution-model 专用 slot：当前两个真实 Adapter 的变化发生在 external-agents 与 composer-picker 之间，立即可用的 seam 应由拥有 Plan 卡的插件声明。

完成标准：上游提案可以单独删除而不影响插件的基础 build/install；插件只对已发布官方版本声明 peer compatibility。

### P3 — 干净官方版本兼容矩阵（已完成）

使用全新、隔离的 `DSH_HOME` 和官方 `@deepseek-ai/dsh@0.1.1-rc.2`：

| 组合 | 必须通过 |
|---|---|
| composer-picker only | composer picker 与插件自有 Plan 卡可用；Approve 前提交 execution model；无 Core slot。 |
| external-agents only | 设置、探测、前台/后台 Worker、Jobs 可用；external Plan handoff 明确不可用且不会启动 Worker。 |
| 两者双装 | external-agents 拥有 Plan 卡；picker 通过 plugin-owned child slot 合并 DSH model/Worker 选择。 |
| dsh-mobile 三插件 | pairing、interaction intents、窄屏 layout 在官方 Runtime 上工作；失败按各自契约降级。 |
| 重连 | 不重复启动 Worker；在 Proposal B 发布前，不把本地 pending wait 当作 Host 权威快照。 |

每个组合执行 package 的 build/test/check，并 smoke-test packed artifact。禁止把 `DSH_UPSTREAM`、`link:` 或源码 alias 指向 dirty DSH checkout。dsh-mobile 的轻量门禁是 `npm run verify:compatibility`，完整 tarball 门禁是 `npm run verify:release`；两者默认固定 `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`，只在单独评审官方升级时显式覆盖 `DSH_EXPECTED_REVISION`。

完成标准：测试环境中的官方 checkout `git status --porcelain` 为空，插件 artifact 不包含官方源码副本或 patch。

### P4 — 恢复官方 checkout（已完成）

P1 与 P3 完成后已执行，避免了用“先删补丁”掩盖尚未迁移的产品依赖。恢复后的两个 checkout 都位于 `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` 且工作树为空；clean-stock 门禁与 3082 rc.2 lab boot 均通过。

1. 验收记录和精确 diff 文件清单保存在 [`issue-3-implementation-evidence.md`](./issue-3-implementation-evidence.md)；不保存可重放的产品 patch。
2. 在两个 checkout 分别确认 HEAD 仍为 `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`。
3. 对已记录的 DSH 目录执行 tracked-file restore：

~~~sh
# question lab：恢复 18-file 实验面
git -C /home/noirbright/Workstation/dsh-question-lab restore --source=HEAD --worktree -- \
  packages/client/connection/src/client/fixture.ts \
  packages/client/runtime/src/client/sessions/session.ts \
  packages/client/runtime/tests/manager.client.spec.ts \
  packages/client/runtime/tests/session.client.spec.ts \
  packages/client/ui-user-questions \
  packages/host/apiproxy

# staging：同上，并恢复 plan-mode sentinel
git -C /home/noirbright/.local/opt/dsh-staging/dsh-v0.1.1-rc.2-b150a551b8d4 restore --source=HEAD --worktree -- \
  packages/client/connection/src/client/fixture.ts \
  packages/client/runtime/src/client/sessions/session.ts \
  packages/client/runtime/tests/manager.client.spec.ts \
  packages/client/runtime/tests/session.client.spec.ts \
  packages/client/ui-user-questions \
  packages/host/apiproxy \
  packages/plan/plan-mode
~~~

4. 两处都执行：

~~~sh
test "$(git rev-parse HEAD)" = b150a551b8d465e31e418e1b2eaf5e79bbb7d28e
git diff --exit-code
test -z "$(git status --porcelain)"
~~~

5. staging 是当前 DSH Web 的实现 checkout。恢复 plain packages 后，从同一 checkout 重建受影响 Web artifact，再刷新现有 `http://127.0.0.1:3080` 验证；不得另起替代服务器。client-plugin 只有在同一 checkout 的 `pnpm run dev:web` watcher 确认运行时才依赖 HMR。
6. lab 只重启/刷新现有 3082 面；production 3080 的发布 profile 不写入 Workstation `link:`。

完成标准：两个官方 checkout 均为 clean rc.2，现有 3080/3082 启动与官方行为一致，插件能力由各自 artifact 提供。

## 回归门禁

- 每个活动插件项目都保留本地 `AGENTS.md` Core 边界。
- `verify:release` 固定官方 remote、clean rc.2 commit，先执行各插件 build/test/check，再从 tarball 启动 composer-only、external-only、combined 与 mobile 四个临时 profile；pack/manifest gate 拒绝源码 alias、Core patch、vendored 官方包、源码/测试/凭据路径和已知 fork-only runtime contract。`cordis.patch.yml` 是插件装载清单，不是 Core patch。
- 官方升级只做 compatibility diff、插件 build/test 与 clean-tag smoke；不在官方 checkout “顺手修复”。
- 上游 PR 合并但未发布时，状态仍视为“seam 不可用”。
- 任何需要恢复 Core patch 才能通过的测试都判定为插件解耦失败。
