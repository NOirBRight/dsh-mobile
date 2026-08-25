# Interaction Operations 插件维护边界

官方 DeepSeek Harness 及其本地 checkout 是只读依赖。输入适配、presentation-only Interaction Intents、兼容 Adapter 和测试全部留在本插件；禁止修改、携带或要求 DSH core patch。业务 mutation、权限、确认和状态仍由官方 DSH UI 拥有。缺少公开 seam 时记录上游提案，并让插件在干净的官方 tag 上降级或关闭该能力。

修改前读取 [移动交互契约](../../docs/mobile-interaction-operations.md) 与 [ADR 0007](../../docs/adr/0007-plugin-owned-interaction-intents.md)。
