# [提案] 为客户端 Runtime 增加可选的会话冷启动水合与按连接代次就绪状态

> 状态：供上游 Discussion 审阅的草稿；尚未发布。

## 摘要

希望在不让官方 Runtime 拥有任何存储策略的前提下，增加一个很小的可选 capability seam：嵌入方可以在首次实时基线到达前提供会话列表／历史窗口 seed，并接收后续权威结果的 commit；Runtime 同时提供一个可重放、按连接 generation 区分的权威就绪状态。

没有 Provider 时，官方行为、wire 协议、Session 对象模型和 UI 均保持不变。Seed 永远不具有权威性，任何 adapter 异常都必须安全降级到现有实时加载路径。

## 动机

远程或移动客户端每次恢复连接时都必须等待：

1. 获取插件清单并启动客户端 Runtime；
2. 拉取 `session.list`；
3. 打开当前 Session 并拉取历史窗口。

嵌入方通常已经拥有可用于首屏绘制的本地快照，但当前 Runtime 没有产品中立的注入位置。若直接把 IndexedDB、key、schema、保留周期或移动端策略写进 Runtime，会把产品策略带入上游；若在 UI 外部伪造 Session 状态，又容易把缓存误认为权威数据。

此外，重连时 mux pending-interaction 回放早于 `onConnected`。若 resync 无条件清空 pending question/approval，刚回放的可回答界面会消失。正确语义应按连接 generation 标记旧身份，并仅在新 generation 回放结束后删除未被确认的项。

## 建议的最小接口

当前验证实现中的公共接口如下：

```ts
type SessionWindowSeedEntry = Pick<HistoryEntry, 'event'>

interface SessionWindowSeed {
  entries: readonly SessionWindowSeedEntry[]
  hasMore: boolean
}

type SessionListSeedEntry = Omit<
  SessionListEntry,
  'running' | 'pendingInteraction' | 'completed' | 'depth'
>

type SessionHydrationCommit =
  | { kind: 'list'; entries: readonly SessionListSeedEntry[] }
  | { kind: 'window'; sessionId: SessionId; window: SessionWindowSeed }

interface SessionHydrationAdapter {
  readList(): readonly SessionListSeedEntry[] | undefined
  readWindow(sessionId: SessionId): SessionWindowSeed | undefined
  committed(change: SessionHydrationCommit): void
}

type SessionBaselineReadinessState = {
  generation: number
  state: 'pending' | 'ready' | 'error'
}

type SessionBaselineReadiness = ObservableSnapshot<SessionBaselineReadinessState>
```

Provider 通过 `ctx.provide('sessionHydration', adapter)` 注册；Runtime 通过 `ctx.provide('sessionBaselineReadiness', store)` 提供就绪快照。

列表 seed 只包含稳定显示事实，不包含 `running`、待处理交互、完成提醒或 UI indentation。Runtime 从 parent 关系重新派生 depth，所有实时位从中性状态开始。

## 语义与不变量

### Seed 非权威

- seed 只在首次成功的实时 baseline 前显示；
- 缓存中的 selection 不能证明 Session 仍然存在；
- 成功的空列表／空历史也是权威结果，必须 commit，不能保留旧的非空快照；
- stream append、gap repair、resync 和成功分页都应回写当前窗口；
- adapter 的读取或写入异常不能阻断官方实时 Runtime。

### Readiness 按 generation 隔离

- 每次新连接 generation 从 `pending` 开始；
- 每个 generation 必须执行自己的实时列表 pull，不能复用上一代仍在进行的 promise；
- 当前 generation 的实时列表 baseline 失败时必须发布 `error`，即使上一代曾经 `ready`；
- 列表失败不能阻止已打开历史窗口 resync，避免继续显示上一代状态；
- 有当前 Session 时，还必须等它的实时历史 baseline 成功；
- 缓存 seed、旧 generation 的成功状态和固定超时都不能产生 `ready`。

### Pending interaction 重连

- 断连时保留最后可回答的 UI，但把其身份标记为 stale；
- 新 mux generation 的回放会确认仍存在的请求；重复回放按稳定 request identity 幂等；
- `onConnected` 仅清理没有被本代回放确认的 stale 请求；
- 因此“回放发生在 resync 之前”不会让问题框消失。

## 所有权划分

Runtime 仅拥有上述 seam、权威生命周期和 fail-soft 规则。以下内容明确留给嵌入方：

- IndexedDB／文件／内存等存储实现；
- key、schema version、迁移和 Host 身份分区；
- 容量、保留周期、隐私和清理策略；
- 是否启用缓存、产品文案和兼容门禁。

这使官方 Runtime 不需要依赖浏览器存储，也不会因一个 Provider 失败而影响普通连接。

## 兼容性策略

下游验证采用两层策略：

- 默认 Core 模式继续使用原始官方 Runtime；
- 可选增强只对精确验证的官方 bundle revision 启用；
- 未知官方更新自动停用增强，不修改、不猜测补丁是否仍可应用；
- Provider 被声明为 Runtime 的注入依赖，避免并发 plugin activation 导致 Runtime 先快照到空 Provider；
- 打包阶段再次校验 downstream bundle SHA-1，拒绝把错误 Runtime 标为受支持 revision。

这些门禁属于下游兼容策略，不建议进入上游 Runtime。

## 已完成的验证实现

- 官方基线：`528c682e061696f5a160f363f236ecbf53cbd006`
- 通用实现提交：`3f7666e10198097edd51ea7cfae596d7486816fb`
- 官方 Runtime bundle revision：`5a9e129c42ae`
- 验证实现 Runtime bundle revision：`335f15577a33`
- 可审阅补丁：`patches/dsh-runtime-session-hydration.patch`
- 机器可读门禁：`patches/dsh-runtime-session-hydration.json`
- 架构说明：`.agents/notes/implemented/architecture/2026-08-22-client-session-hydration-readiness.md`

验证结果：

- Runtime 聚焦测试：168/168；
- 移动 Shell 完整测试：149/149；
- `npm run verify:cold-start` 验证 Host-scoped 列表与选中历史在 transport ready 前已可绘制；
- Runtime TypeScript typecheck：通过；
- `lint:contracts-ready`：通过；
- `verify-export-jsdoc`：通过；
- 下游 bundle 不含移动端存储 key 或 DOM/localStorage 策略；
- 原始官方 worktree 与 `master` 保持在基线提交，没有合入验证 patch。

## 希望维护者确认的问题

1. `sessionHydration` 作为可选 Cordis capability 的位置是否合适？
2. 列表 seed 是否还应进一步缩小为一个独立 DTO，而不是对 `SessionListEntry` 使用 `Omit`？
3. readiness 应继续由 Runtime 提供 replayable snapshot，还是更适合成为现有 connection/session 状态的一部分？
4. pending-interaction 的 generation fencing 是否应作为独立修复先合入？
5. 若接口方向认可，是否希望拆成“pending interaction 修复”和“hydration/readiness seam”两个 PR？
