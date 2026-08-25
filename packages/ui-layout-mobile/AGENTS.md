# Mobile Layout 插件维护边界

官方 DeepSeek Harness 及其本地 checkout 是只读依赖。窄屏空间布局、官方 slot 契约的兼容 Adapter 和测试全部留在本插件；禁止修改、复制修改版或要求 DSH core patch。官方 DSH 继续拥有 leaf feature UI、状态和宽屏布局。契约不兼容时回退官方 root，并记录缺失 seam 与上游提案。

修改前读取本目录 [README](README.md) 与 [响应式布局 ADR](../../docs/adr/0004-responsive-layout-and-design-ownership.md)。
