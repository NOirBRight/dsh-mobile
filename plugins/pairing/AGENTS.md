# Pairing 插件维护边界

## Core 边界

官方 DeepSeek Harness 及其本地 checkout 是只读依赖。Host Gateway、配对、设置 UI、兼容 Adapter 和测试全部留在本插件；禁止修改、携带或要求 DSH core patch。缺少公开 Interface、slot 或 RPC 时，记录上游提案，并让插件在干净的官方 tag 上降级或关闭该能力。

## 发布同步

本目录是 monorepo 的集成镜像；发布源是 `/home/noirbright/Workstation/dsh-mobile-pairing`。涉及发布的改动按 [配对发布流程](../../docs/pairing-release-workflow.md) 同步，两个项目都必须保持 Core 边界。
