# @dsh-mobile/bundle-mobile-web（legacy）

这是早期“独立 mobile-web DSH profile”实验，保留用于历史对照，不属于 Android 运行或部署链路。

生产 Android 方案不得启动该 profile：它可能与日常 web 共享 DSH_HOME，违反 one live writer per session。Android APK 使用本地 shell，并通过已认证 RTCDataChannel 从现有 3080 profile 获取 Host manifest 和业务插件 bundle；移动布局由 APK 自带。

新的实现与操作说明见根 README、apps/mobile-web/README.md 和已发布的 dsh-mobile-pairing（https://github.com/NOirBRight/dsh-mobile-pairing）。
