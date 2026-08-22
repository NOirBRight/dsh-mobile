# dsh-mobile

DeepSeek Harness 的 Android 客户端，独立于上游 deepseek-harness 开发。

## 终态架构

- **Android 本地壳**：Capacitor APK 内含 WebView shell、字体、样式和优化版移动布局，不访问 CDN 或静态站。浏览器 Product Client 已按 ADR 0005 移除。
- **相机自动配对**：首次启动自动扫描桌面端 QR；也接受 dsh-mobile://pair#offer=... Deep Link。
- **连接入口**：用户界面只提供 Quick（临时地址）和 Relay（国内/海外两个预置 WSS 地址）。Relay 按用户独立 Room 转发 sealed frames，不暴露 DSH :3080。旧 Host-owned Custom Endpoint 仅兼容已有配置。
- **连接策略**：默认隧道优先——立即经所配置端点建立加密 Tunnel 会话；WebRTC 直连仅作为同网场景的限时并行优化。Direct Only 与 Tunnel Only 可选。无 TURN；端点只做不可信管道。
- **端到端认证**：任何路由建立后仍执行以 QR Host 公钥为信任锚的 NaCl hello/ack。Endpoint 提供者不可信。
- **带宽预算**：隧道只承载封装协议帧;素材全部打包在 APK,插件 bundle 按内容哈希缓存。
- **一个 DSH writer per Host**：正式版 `@dsh-mobile/pairing` 可安装到日常 `:3080` 或 lab `:3082`，各自回环到自己的 DSH。两套都安装时必须保持独立的 `DSH_HOME`、Host Identity、Gateway 端口和 Public Endpoint，不得共用同一个 `43169` 或自定义域名，也不得启动共享同一 `DSH_HOME` 的第二个 DSH。

Host 的插件清单和业务插件 bundle 经已认证会话获取；移动壳在窄屏把桌面布局条目替换为 APK 内置的 @dsh-mobile/ui-layout-mobile。

## 官方兼容与可选增强

软件默认运行在 **兼容模式**，Core pairing 插件可直接安装到原版 DSH，不替换或修改官方 Runtime：

| 能力 | 默认兼容模式 | 可选会话缓存增强 |
|---|---:|---:|
| QR 配对、设备管理、Tunnel/Relay | ✅ | ✅ |
| 官方 DSH UI 与业务插件 | ✅ | ✅ |
| Host-scoped 冷启动会话列表/历史 | — | ✅ |
| 上次会话恢复、权威刷新状态 | — | ✅ |
| 官方更新后的保证 | Core 继续工作 | 仅精确验证版本启用；未知版本自动停用 |

“设备连接”面板会说明当前模式并允许用户选择；Core 的连接状态明确显示不提供权威刷新确认，不会把 transport-open 冒充数据就绪。增强模式只在官方 Runtime bundle revision 与 `patches/dsh-runtime-session-hydration.json` 中的白名单完全一致时，插入本地 adapter 并使用 APK 内置的 downstream-compatible Runtime。官方升级导致 revision 变化时，不静默打补丁、不允许未知版本强制启用，自动回退到未经修改的官方 Runtime；配对、连接和设备管理不受影响。

缓存策略完全归 dsh-mobile：IndexedDB v2 key 使用 Host Identity 隔离；读取前验证 schema；仅单 Host 配置可迁移旧的未分区 v1 localStorage；空的权威结果会覆盖旧快照；失败的写入保留到后续 flush 重试；历史记录不会因为插件缓存配额而被逐出。上游 seam 只接触同步 seed、权威 commit 与 replayable readiness，不知道移动端存储策略。

“设备连接”还提供默认关闭的 **后台连接保护（实验）**。开启后 Android 会请求通知权限、启动 remote-messaging Foreground Service、持有 CPU wake lock，并用常驻通知明确告知用户。它可显著减少 WebView 连接在后台被暂停，但当前加密 Tunnel 仍由 WebView 拥有；Android 强杀进程、厂商省电策略或 WebView 冻结仍可能中断接收，因此不得把该模式描述为绝对可靠的后台推送。彻底可靠需要后续将加密 transport 所有权迁入 native 层，或增加 Host 到设备的系统 Push 唤醒路径。

架构决策见 docs/adr/0005-vps-endpoint-tunnel-first-app-only.md 与 docs/adr/0006-regional-official-sealed-relay.md；Relay Docker 部署见 relay/deploy/README.md；执行顺序见 PLAN.md。

## 目录

- apps/mobile-web：Android shell、扫码入口、fetch/WebSocket shim。
- packages/e2e-tunnel：可发布的 NaCl tunnel、WebRTC 信令、连接策略与不超过 60 KiB 的 DataChannel 分片。
- packages/ui-layout-mobile：单栏抽屉移动布局。
- packages/session-hydration-mobile：仅在精确版本门禁通过时注册缓存 adapter/readiness bridge。
- patches：基于固定官方 commit 的通用 Runtime seam patch 与机器可读兼容元数据。
- plugins/pairing：可发布的 Cordis Host 插件（Host Gateway、werift answerer、回环 tunnel endpoint）。
- relay：多用户、独立 Room 的 opaque sealed-frame Relay；Docker/Caddy 配方位于 relay/deploy/。

## 构建与测试

~~~sh
npm install
npm test
npm run build
npm run android:debug --workspace @dsh-mobile/mobile-web
~~~

APK：apps/mobile-web/android/app/build/outputs/apk/debug/app-debug.apk。

Android 工具链默认使用 Java 21 JDK 和 ANDROID_HOME=/home/noirbright/Android/Sdk。
