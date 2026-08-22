# @dsh-mobile/pairing

DSH Mobile 的 Host 插件。正式版可安装在日常 `:3080` 或 lab `:3082` web profile 中；每个 DSH 进程独立提供配对管理、回环 Host Gateway、WebRTC Direct 与加密 Tunnel Fallback。

## 数据路径

1. Host Gateway 只监听回环地址，提供信令和加密 Tunnel 入口。产品 UI 在 APK 里，Gateway 不提供浏览器 Shell。
2. Quick Tunnel 或手工配置的 Custom Endpoint 将这个有界 Gateway 暴露为 Public Endpoint。
3. GET /pair 铸造五分钟、单次使用的 v4 offer；Android QR 使用 dsh-mobile://pair 深链。
4. Automatic 立刻走加密 Tunnel；同网 Direct 只在短宽限内可以抢赢，迟到的 Direct 不得抢走已打开的 Tunnel。
5. 首配签发的 Device Token 持续有效，直到 Host 侧撤销。

没有 TURN、运行时 CDN 或维护者域名依赖。Tunnel Fallback 可以走用户自己的 Host Public Endpoint，也可以显式选择官方或自托管的加密 Relay。Relay 只转发密文帧。

## 在 GUI 中配对

打开 **设置 → 插件 → 插件配置 → DSH Mobile**：

- 展开卡片可查看当前 Public Endpoint 和 Host Identity。
- 二维码只给 Android APK。
- “刷新二维码”会立即铸造新的五分钟单次 offer。
- “打开完整设备管理”还可查看设备、刷新既有设备二维码和执行 Host 侧撤销。

## 配置位置

正式版安装：

~~~sh
pnpm add github:NOirBRight/dsh-mobile-pairing#v0.1.1
~~~

然后把 `@dsh-mobile/pairing` 加入 profile 的 `dsh.profile.bundles`。包内的 `cordis.patch.yml` 会插入 Remote loader；默认配置面向日常 `:3080`：

~~~yaml
- id: dsh-mobile-pairing
  config:
    dshHost: 127.0.0.1
    dshPort: 3080
    gatewayBind: 127.0.0.1
    gatewayPort: 0
~~~

lab profile 使用 `:3082` 时，将该 profile 的配置覆盖为 `dshPort: 3082`，并使用独立的 Gateway/Public Endpoint。两个 DSH 可以同时安装，但不能共用 `43169` 或同一个自定义域名。

| 键 | 默认 | 说明 |
|---|---|---|
| appUrl | dsh-mobile://pair | Android QR / Deep Link 入口 |
| endpointMode | quick | GUI 只显示 quick（临时地址）和 relay（Relay）；custom 仅作为旧配置兼容模式保留 |
| customEndpointUrl | 无 | 旧 operator overlay 兼容字段；不在当前 GUI 选项中显示 |
| relayUrl | 无 | relay 模式下必填，必须是无凭据的 WSS URL |
| gatewayBind / gatewayPort | 127.0.0.1 / 0 | Host Gateway 始终只允许回环绑定 |
| cloudflaredPath | cloudflared | 默认 Quick Tunnel 可执行文件 |
| quickTunnelCommand / quickTunnelArgs | cloudflared 默认 argv | 可换成 natapp / cpolar / frpc 等能打印 HTTPS URL 的命令 |
| quickTunnelEndpointPattern | trycloudflare.com | 从子进程日志里抽出 HTTPS 端点的正则 |
| stunUrls | [stun:stun.cloudflare.com:3478] | 仅 STUN；TURN/TURNS 会 fail loud |
| dshHost / dshPort | 127.0.0.1 / 3080 | 有界 Gateway 的 DSH 上游；lab 写成 3082 |
| codeTtlMs | 300000 | 首配 offer/code 有效期 |

### Quick Tunnel 其它提供者

默认是 cloudflared。下面只是配置样例，不打进 APK，也不作为产品默认依赖。`{gateway}` 会换成回环 Gateway URL。

~~~yaml
# natapp
quickTunnelCommand: natapp
quickTunnelArgs: ['-authtoken', 'YOUR_TOKEN']
quickTunnelEndpointPattern: 'https://[a-z0-9-]+\\.natapp4?\\.cc\\b'

# cpolar
quickTunnelCommand: cpolar
quickTunnelArgs: ['http', '{gateway}']
quickTunnelEndpointPattern: 'https://[a-z0-9-]+\\.cpolar\\.(?:cn|top)\\b'

# frpc（仅旧 operator overlay 兼容；新用户使用 Relay）
quickTunnelCommand: frpc
quickTunnelArgs: ['-c', '/etc/frp/frpc.toml']
quickTunnelEndpointPattern: 'https://mobile\\.example\\.com\\b'
~~~

### 域名与 Relay

- **临时域名**：endpointMode: quick 自动生成，不能手工固定。
- **旧 Custom Endpoint**：仅为已有 operator overlay 保留兼容，不在当前 GUI 选项中展示；Relay 用户只选择两个预置 Relay 区域。
- **Relay**：选择 endpointMode: relay 并填写 relayUrl。官方区域和 Docker 自托管部署见 [relay/deploy/README.md](../../relay/deploy/README.md)。每个 Client Instance 使用独立 Room。
- dsh.noirbright.top、dshweb.noirbright.top、dshapp.noirbright.top 等个人域名只能作为个人恢复基础设施，不是产品默认值或依赖。

严禁启动共享同一 DSH_HOME 的第二个 DSH 进程来承载本插件。

## 验证

~~~sh
npm test
npm run typecheck
npm run build
npm pack --dry-run
~~~
