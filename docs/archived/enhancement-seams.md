# 官方 DSH 基线与移动插件职责

## 官方基线

本项目维护 dsh-mobile 的插件与移动端 artifact。官方 `deepseek-ai/deepseek-harness` 是只读构建依赖；移动端需求通过已发布的插件 seam 实现，缺失的 Interface、slot 或 RPC 通过上游提案解决，官方版本发布前不引入本地 DSH patch。

官方基线固定为 tag `dsh-v0.1.2-alpha.1`、commit `cd5ef8148158c3a752a658978873241fdf8e2bbc`。验证器检查官方 remote、精确 tag、精确 commit 和 clean worktree，不接受 commit 覆盖。

跨插件耦合审查见[已归档审查](./published-plugin-coupling-review-2026-08-26.md)。本文件不定义其他插件的 owner、child slot 或兼容性矩阵。

## 移动端职责

官方 DSH 拥有 Session、pending interaction、question/approval 生命周期、wire schema、Plan Mode、`exit_plan_mode` 工具语义，以及 Cordis、client boot、slot、settings、RPC/event 和 Jobs Interface。官方 DSH 不承载 dsh-mobile 专用的 sentinel、文案、CSS 或 child slot。

`@dsh-mobile/pairing` 的唯一来源是已发布的 Pairing artifact；它拥有 Host Gateway、配对、设置 UI 与 sealed transport。dsh-mobile 不维护本地 Pairing 源码镜像。官方 `settings.section` 没有 icon 字段时，设置图标使用临时 DOM Adapter 并静默回落。

`packages/interaction-operations` 负责输入归一化、surface stack、Back 路由和 presentation-only intents，不执行业务 mutation。`packages/ui-layout-mobile` 负责窄屏布局、移动端 surface 注册、历史窗口恢复、统计行和问题页 footer；契约失败时回退官方 root。`packages/e2e-tunnel` 提供 direct WebRTC 与 sealed frame transport；Relay 只转发 opaque sealed frame，不解释业务 payload。

## 发布 artifact 与严格验证

严格验证只接受发布的 Pairing tarball。`MOBILE_PAIRING_TARBALL` 与精确小写 64 位 SHA-256 `MOBILE_PAIRING_SHA256` 必须同时提供；严格模式拒绝 `MOBILE_PAIRING_ROOT`，并在读取 manifest、安装、启动 profile 和使用后重新验证 tarball。

Pairing artifact 是 `@dsh-mobile/pairing@0.1.11`，`dependencies` 精确声明 `github:NOirBRight/dsh-e2e-tunnel#v0.1.4`。严格验证拒绝源码 alias、官方源码副本、Core patch、credential-bearing packed paths 和缺失的 manifest entry targets；Pairing 自身的 strict pack gate 负责未声明运行时依赖闭包。

本地开发可以显式使用 `MOBILE_PAIRING_ROOT` 或未认证 tarball，但只能使用带 `:dev` 后缀的命令，并标记 `releaseEvidence: false`。

## 移动矩阵

矩阵使用隔离的 `DSH_HOME`、固定官方 checkout 和严格 Pairing artifact。官方 checkout 在隔离目录中构建：复制只接受 regular files 和 directories，来源链接直接跳过；`node_modules` 从复制树排除并用 offline、frozen-lockfile、ignore-scripts 的 `pnpm install` 在隔离目录重建。构建只运行官方 `pnpm run clean` 和 `pnpm run build`，生成的 CLI 是普通文件并在每次执行前重新检查 digest。

矩阵运行 dsh-mobile 的 typecheck、测试、architecture audit 和 build，安装 Pairing tarball 与 interaction/layout artifact，启动 mobile profile，检查 boot entries 与 served bundles，并在成功或失败后清理临时 profile。

| profile | required entries |
|---|---|
| mobile | `@dsh-mobile/pairing`、`@dsh-mobile/interaction-operations`、`@dsh-mobile/ui-layout-mobile`，每项恰好一次 |

严格 release evidence 只来自 immutable Pairing tarball、对应 SHA-256 和上述官方 checkout；source root、邻近 checkout 与自动发现的文件不属于 release evidence。

## 验证证据

验收证据与命令见[Issue #3 implementation evidence](../issue-3-implementation-evidence.md)。
