# @dsh-mobile/mobile-web

Android-first 的 Capacitor 本地应用壳。运行 origin 为 https://localhost，APK 内含 Vite shell、全部前端基础资产和优化版移动布局；产品默认不依赖公共 Web 域名、CDN 或 VPS 静态托管。相同 dist 可以由运维方独立部署为 offer 启动的可选 HTTPS 浏览器入口。

## 配对

1. 没有已配对设备时，App 自动调用 @capacitor/barcode-scanner 的后置摄像头扫描 QR。
2. 产品默认 QR/Deep Link 为 `dsh-mobile://pair#offer=<base64url(JSON)>`。若运维方部署了独立浏览器 shell，可显式配置 Host `appUrl`（离线检查脚本使用 `DSH_MOBILE_APP_URL`）生成 `https://mobile.example.com/#offer=...`。
3. v4 offer 包含 Host-owned HTTPS Public Endpoint、房间、Host 公钥、短期 code、能力位和仅 STUN 的 ICE 列表。TURN 会被拒绝。
4. 默认 Automatic：先建立 RTCDataChannel，直连传输失败后走同一 Endpoint 上的加密 Tunnel Fallback。NaCl hello/ack 和 DSH 流量只走已认证会话。deviceToken 保存在 App 私有 vault，用于后续自动重连。

用户取消或扫码失败时显示“重新扫码”；运行中的 Deep Link 由 Capacitor App listener 接收并自动重载配对。

## Personal Recovery Surface 示例

维护者当前把 `dshweb.noirbright.top` 与 `dshapp.noirbright.top` 作为个人恢复入口，并在个人 Host profile 中显式将 `appUrl` 配置为后者。这两个域名不是产品默认值、公共服务或运行依赖；其他部署必须使用自己的域名和配置。

## 本地插件资产

npm run build 会构建 @dsh-mobile/ui-layout-mobile 与 @dsh-mobile/session-hydration。移动布局始终作为窄屏 Core 资产；hydration provider 与 downstream-compatible Runtime 也会打包进 APK，但只有用户选择增强模式且官方 Runtime revision 精确匹配白名单时才进入 boot graph。默认兼容模式保留 Host 官方 Runtime 原条目。Host 其余插件 bundle 经 tunnel fetch，转为本地 Blob URL 后交给 DSH ModuleLoader。没有静态镜像步骤。

会话缓存使用 Host Identity 分区的 IndexedDB v2；旧 v1 localStorage 只在本机恰有一个 Host Profile 时迁移。官方更新不匹配时增强自动停用，界面解释原因，Core 配对、Tunnel/Relay 与官方 UI 保持可用。

## Android 命令

| 命令 | 作用 |
|---|---|
| npm run android:copy | 构建并刷新 WebView 资产 |
| npm run android:sync | 构建、刷新资产并同步 Capacitor 插件 |
| npm run android:debug | build → sync → Gradle assembleDebug |

默认工具链为 Java 21 JDK、ANDROID_HOME=/home/noirbright/Android/Sdk、Android minSdk 26。权限为 INTERNET 与 CAMERA，并声明摄像头硬件。APK 输出在 android/app/build/outputs/apk/debug/app-debug.apk。
