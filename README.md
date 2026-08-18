# dsh-mobile

DeepSeek Harness 的 Android 客户端，独立于上游 deepseek-harness 开发。

## 终态架构

- **Android 本地壳**：Capacitor APK 内含 WebView shell、字体、样式和优化版移动布局，不访问 CDN 或静态站。
- **相机自动配对**：首次启动自动扫描桌面端 QR；也接受 dsh-mobile://pair#offer=... Deep Link。
- **Host-owned Public Endpoint**：每个 Host 用 Cloudflare Quick Tunnel 或运维方 Custom HTTPS 暴露回环 Host Gateway。Gateway 只做 WebRTC 信令和加密 Tunnel Fallback，从不暴露 DSH :3080。
- **连接策略**：默认 Automatic，先走可靠有序 RTCDataChannel；直连传输失败后使用同一 Endpoint 上的加密 Tunnel Fallback。Direct Only 与 Tunnel Only 可选。无 TURN，也无项目运营的应用数据 Relay。
- **端到端认证**：WebRTC 或 Tunnel 建立后仍执行以 QR Host 公钥为信任锚的 NaCl hello/ack。Endpoint 提供者不可信。
- **一个 DSH writer**：@dsh-mobile/pairing 必须挂入日常 web profile，同进程回环到 3080。不得启动共享同一 DSH_HOME 的第二个 DSH。

Host 的插件清单和业务插件 bundle 经已认证会话获取；移动壳在窄屏把桌面布局条目替换为 APK 内置的 @dsh-mobile/ui-layout-mobile。

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
