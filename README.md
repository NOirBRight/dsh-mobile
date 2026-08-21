# dsh-mobile

DeepSeek Harness 的 Android 客户端，独立于上游 deepseek-harness 开发。

## 终态架构

- **Android 本地壳**：Capacitor APK 内含 WebView shell、字体、样式和优化版移动布局，不访问 CDN 或静态站。浏览器 Product Client 已按 ADR 0005 移除。
- **相机自动配对**：首次启动自动扫描桌面端 QR；也接受 dsh-mobile://pair#offer=... Deep Link。
- **Host-owned Public Endpoint**：零配置默认是 Cloudflare Quick Tunnel；稳定推荐是运维方自托管 Custom Endpoint（如 SSH 反向隧道 + Caddy TLS，固定域名与固定 Gateway 端口）。无项目运营的共享 Relay。一个端点服务该 Host 的全部已配对设备（按设备独立房间）。Gateway 只做 WebRTC 信令和加密 Tunnel Fallback，从不暴露 DSH :3080。
- **连接策略**：默认隧道优先——立即经所配置端点建立加密 Tunnel 会话；WebRTC 直连仅作为同网场景的限时并行优化。Direct Only 与 Tunnel Only 可选。无 TURN；端点只做不可信管道。
- **端到端认证**：任何路由建立后仍执行以 QR Host 公钥为信任锚的 NaCl hello/ack。Endpoint 提供者不可信。
- **带宽预算**：隧道只承载封装协议帧;素材全部打包在 APK,插件 bundle 按内容哈希缓存。
- **一个 DSH writer**：@dsh-mobile/pairing 必须挂入日常 web profile，同进程回环到 3080。不得启动共享同一 DSH_HOME 的第二个 DSH。

Host 的插件清单和业务插件 bundle 经已认证会话获取；移动壳在窄屏把桌面布局条目替换为 APK 内置的 @dsh-mobile/ui-layout-mobile。

架构决策见 docs/adr/0005-vps-endpoint-tunnel-first-app-only.md；生产端点部署与迁移缺口见 docs/vps-endpoint-deployment.md；执行顺序见 PLAN.md。

## 目录

- apps/mobile-web：Android shell、扫码入口、fetch/WebSocket shim。
- packages/e2e-tunnel：可发布的 NaCl tunnel、WebRTC 信令、连接策略与不超过 60 KiB 的 DataChannel 分片。
- packages/ui-layout-mobile：单栏抽屉移动布局。
- plugins/pairing：可发布的 Cordis Host 插件（Host Gateway、werift answerer、回环 tunnel endpoint）。
- relay：遗留 signaling-only 房间服务，不是产品数据面。

## 构建与测试

~~~sh
npm install
npm test
npm run build
npm run android:debug --workspace @dsh-mobile/mobile-web
~~~

APK：apps/mobile-web/android/app/build/outputs/apk/debug/app-debug.apk。

Android 工具链默认使用 Java 21 JDK 和 ANDROID_HOME=/home/noirbright/Android/Sdk。
