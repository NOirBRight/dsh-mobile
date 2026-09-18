# Mobile Layout 插件维护边界

官方 DeepSeek Harness 及其本地 checkout 是只读依赖。窄屏空间布局、官方 slot 契约的兼容 Adapter 和测试全部留在本插件；禁止修改 `.dsh-upstream` 或要求 DSH core patch。Alpha.4 / 0.1.5 壳 seed 缺少 alpha.2 Host 所需的 primitives 运行时导出（`isDarwinDesktop`、`Checkbox`、`MarkdownDelegateProvider`、额外图标、`SHIELD_OUTLINE_*`）时，由 `apps/mobile-web` 的 `DSH_PRIMITIVES_SEED` 只把 `ui-primitives` 接到 alpha.2 src（npm 依赖仍从 0.1.5 Host seed 的 nested `node_modules` 解析），缺树则构建失败，并记为缺失 seam。HOST_FACES 四枚图标与 `isDarwinDesktop` 的 Vite transform 在 seed 已含这些导出时 no-op，仅作旧 seed 回退。0.1.5 壳 seed 的 SlotCore 缺少 alpha.2 `registerFactory` 时，由 `DSH_SLOTS_SEED` 只把 `ui-slots` 接到 alpha.2 src。官方 DSH 继续拥有 leaf feature UI、状态和宽屏布局。**布局 slot 契约**（四条 children 声明）不兼容时回退官方 root；壳 seed 版本缺口走上述 Adapter，不为此交出移动 root。

修改前读取本目录 [README](README.md) 与 [响应式布局 ADR](../../docs/adr/0004-responsive-layout-and-design-ownership.md)。
