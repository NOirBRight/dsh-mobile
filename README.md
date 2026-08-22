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

架构决策见 docs/adr/0005-vps-endpoint-tunnel-first-app-only.md 与 docs/adr/0006-regional-official-sealed-relay.md；Relay Docker 部署见 relay/deploy/README.md；执行顺序见 PLAN.md。

## 目录

- apps/mobile-web：Android shell、扫码入口、fetch/WebSocket shim。
- packages/e2e-tunnel：可发布的 NaCl tunnel、WebRTC 信令、连接策略与不超过 60 KiB 的 DataChannel 分片。
- packages/ui-layout-mobile：单栏抽屉移动布局。
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
