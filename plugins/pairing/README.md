# @dsh-mobile/pairing

DSH Mobile 的 Host 插件。它安装在日常 web profile 中，同一进程提供配对管理、回环 Host Gateway、WebRTC Direct 与加密 Tunnel Fallback。

## 数据路径

1. Host Gateway 只监听回环地址，提供信令和加密 Tunnel 入口。产品 UI 在 APK 里，Gateway 不提供浏览器 Shell。
2. Quick Tunnel 或手工配置的 Custom Endpoint 将这个有界 Gateway 暴露为 Public Endpoint。
3. GET /pair 铸造五分钟、单次使用的 v4 offer；Android QR 使用 dsh-mobile://pair 深链。
4. Automatic 立刻走加密 Tunnel；同网 Direct 只在短宽限内可以抢赢，迟到的 Direct 不得抢走已打开的 Tunnel。
5. 首配签发的 Device Token 持续有效，直到 Host 侧撤销。

没有 TURN、公共应用数据 Relay、运行时 CDN 或维护者域名依赖。Tunnel Fallback 由用户自己的 Host Public Endpoint 承载。

## 在 GUI 中配对

打开 **设置 → 插件 → 插件配置 → DSH Mobile**：

- 展开卡片可查看当前 Public Endpoint 和 Host Identity。
- 二维码只给 Android APK。
- “刷新二维码”会立即铸造新的五分钟单次 offer。
- “打开完整设备管理”还可查看设备、刷新既有设备二维码和执行 Host 侧撤销。

## 配置位置

编辑正在运行的 profile 的 cordis.patch.yml，找到：

~~~yaml
- id: dsh-mobile-pairing
  name: '@dsh-mobile/pairing'
  config:
    appUrl: dsh-mobile://pair
    endpointMode: quick
    gatewayBind: 127.0.0.1
    gatewayPort: 0
    dshHost: 127.0.0.1
    dshPort: 3082
    cloudflaredPath: /home/USER/.dsh-lab/mobile/bin/cloudflared
    stunUrls:
      - stun:stun.cloudflare.com:3478
    enableDirect: true
~~~

本机验收走 lab profile：`~/.dsh-lab/profiles/web/cordis.patch.yml`（DSH `:3082`）。不要把 pairing 挂到 `:3080`。

| 键 | 默认 | 说明 |
|---|---|---|
| appUrl | dsh-mobile://pair | Android QR / Deep Link 入口 |
| endpointMode | quick | quick 使用临时 Cloudflare Quick Tunnel；custom 使用手工 Endpoint |
| customEndpointUrl | 无 | custom 模式下必填，必须是无凭据的 HTTPS URL |
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

# frpc（固定域名时更适合直接用 custom endpointMode）
quickTunnelCommand: frpc
quickTunnelArgs: ['-c', '/etc/frp/frpc.toml']
quickTunnelEndpointPattern: 'https://mobile\\.example\\.com\\b'
~~~

### 域名与 Relay

- **临时域名**：endpointMode: quick 自动生成，不能手工固定。
- **自定义域名**：在 Host 设置里选择 Custom Endpoint 并保存；保存前会做分阶段检查。也可手写 endpointMode: custom 和 customEndpointUrl。运行时选择写在 `$DSH_HOME/mobile/public-endpoint.json`，会覆盖 YAML 默认值。
- **Relay**：当前产品没有公共 Relay 设置。旧的 signalingUrl 仅保留在类型中用于历史兼容，不应写入生产 profile，也不是 Tunnel Fallback。
- dsh.noirbright.top、dshweb.noirbright.top、dshapp.noirbright.top 等个人域名只能作为个人恢复基础设施，不是产品默认值或依赖。

严禁启动共享同一 DSH_HOME 的第二个 DSH 进程来承载本插件。

## 验证

~~~sh
npm test
npm run typecheck
npm run build
npm pack --dry-run
~~~
