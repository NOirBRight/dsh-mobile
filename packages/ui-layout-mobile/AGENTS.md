# Mobile Layout 插件维护边界

官方 DeepSeek Harness 及其本地 checkout 是只读依赖。窄屏空间布局、官方 slot 契约的兼容 Adapter 和测试全部留在本插件；禁止修改 `.dsh-upstream` 或要求 DSH core patch。Alpha.4 seed 缺少 0.1.6 HOST_FACES 四枚图标时，由 `apps/mobile-web` 的 Vite transform 接到 **seeded** primitives 模块（见 README），并记为缺失 seam。0.1.5 壳 seed 的 SlotCore 缺少 alpha.2 `registerFactory` 时，由 `apps/mobile-web` 的 `DSH_SLOTS_SEED` 只把 `ui-slots` 接到 alpha.2 src（其余 Host seed 仍钉 0.1.5），缺树则构建失败，并记为缺失 seam。官方 DSH 继续拥有 leaf feature UI、状态和宽屏布局。**布局 slot 契约**（四条 children 声明）不兼容时回退官方 root；壳 seed 版本缺口走上述 Adapter，不为此交出移动 root。

修改前读取本目录 [README](README.md) 与 [响应式布局 ADR](../../docs/adr/0004-responsive-layout-and-design-ownership.md)。
