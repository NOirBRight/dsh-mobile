# dsh-mobile 规划文档

为 DeepSeek Harness 提供手机客户端的独立项目。本文档是设计起点:目标、架构事实、四组件设计、连接模式、里程碑。事实以项目立项讨论为准;涉及上游仓库的事实均注明出处。

## 1. 项目目标与非目标

**目标**

- 为 DeepSeek Harness 提供一个手机客户端:在手机上查看和驱动 dsh 会话(对话与审批优先)。
- 独立目录、独立版本节奏:全部代码 out-of-tree,不进入 deepseek-harness 仓库,不修改上游核心代码。
- 一套配对流程覆盖全部连接场景:局域网直连、用户自备可达性(Tailscale/IPv6)、relay 兜底。

**非目标(v1)**

- 不 fork、不打补丁、不 vendor 上游仓库;上游的问题在上游修或在外层绕开。
- 不做原生 App(React Native 等);v1 形态是移动 Web(PWA)。是否升级原生壳见 §8 开放问题。
- 不做多用户/SaaS 化;relay 是自用单实例。
- 不改变 dsh 的模型协议与会话语义;移动端只是又一个 client 形态。

## 2. 关键架构事实(上游,决定设计空间)

1. **Web GUI 分三层**:数据层 `@deepseek-ai/dsh-client-runtime`(React-free,ConnectionController → SessionManager → Session 拥有全部业务状态)、渲染机械 `dsh-client-web-react`(ctx→React 桥、slot 渲染器)、表现层 `ui-*` 插件(纯 props 组件,官方定位为"consumables, expected to be rewritten wholesale")。来源:packages/client/AGENTS.md「Layering red lines」。
2. **根布局本身就是一个插件**:`@deepseek-ai/dsh-client-ui-layout` 注册进内建 `'root'` slot,声明 4 个子 slot(可见 `'sidebar'`、`'shell.overlay'`),AppFrame 是三栏桌面壳。来源:packages/client/ui-layout/src/client/index.ts、AppFrame.tsx。
3. **slot 契约在加载期校验**:渲染未声明的 slot、或声明他人已声明的 slot,均在 load 时失败;插件间组合只允许走 slots 与 ctx 服务。来源:packages/client/AGENTS.md「Slot and props discipline」。含义:契约漂移 fail-loud,升级时立刻暴露,不会悄悄坏。
4. **bundle 是可安装的 patch 层**:manifest 声明 `"dsh": {"bundle": {"patch": "./cordis.patch.yml"}}`;out-of-tree bundle 经 `dsh plugin --profile <name> add <package>` 装入组合。来源:packages/bundle/README.md。
5. **浏览器花名册是数据**:web-app bundle 的 cordis.patch.yml 里 `dsh.client` 行被 modules 的 node 半扫描进 `window.__DSH_BOOT__`。来源:packages/client/modules/README.md、packages/bundle/web-app/cordis.patch.yml。
6. **相关包均为 public npm 包**:`dsh-client-runtime`、`dsh-client-web`、`dsh-client-web-react`、`dsh-client-ui-layout`、`dsh-web-app` 全部 `private: false`,版本 0.1.0-rc.5。来源:各 package.json。含义:独立目录可以直接 npm 依赖它们。
7. **上游没有认证层**:webserver 的 `host` 只接受 `127.0.0.1`(默认)与 `0.0.0.0`,README 明示 "No TLS, auth, or origin policy";`/api` 有 Host 信任围栏(loopback 或 `trustedHosts`,WHATWG 规范化比较,DNS-rebinding 防御),但围栏"is a reachability policy, not authentication";且 "`dsh web --host 0.0.0.0` is intentionally unsupported until remote access has an authentication layer"。来源:packages/host/webserver/README.md「Known Limitations」、packages/client/connection/README.md「/api browser-trust fence」。含义:认证层是上游刻意留空的位置,正是本项目要补的拼图。
8. **客户端载体可替换**:浏览器载体 = `/api` HTTP POST(unary/respond)+ `/api/events.mux`、`/api/events.host` 两条下行 WebSocket;存在 `AbstractApiClient` 抽象,in-process carrier 满足同一双流抽象。来源:packages/client/connection/README.md。含义:E2E 加密可以做成一个 carrier 实现换掉默认浏览器载体,不动业务代码。
9. **上游处于预发布期**:根 AGENTS.md 明示 "Remove this section at the first tagged release",可自由改名、无兼容承诺。含义:必须 pin 版本、按 release 跟进。
10. **样式体系不支持外部覆盖**:`--dsw-*` token + CSS Modules + clsx,无 Tailwind/组件库;CSS Modules 的 hash 类名使外部 CSS 无法可靠覆盖组件内部;全库 @media 仅约 32 处且多为 `prefers-reduced-motion`,移动端错乱是结构性的(三栏固定壳),不是补几条 media query 能解决的。来源:packages/client/AGENTS.md「Styling」、packages/client 全库 grep。
11. **特权方法集钉在 node 半(回环)**:`host.pickDirectory`、`host.openPath`、settings/credentials 配置面、agent-preset 创作面等由 node 半钉住。来源:packages/client/connection/README.md。含义:任何把服务暴露到 LAN 的设计都要意识到——把 Host 改写为回环的代理会把这些方法间接暴露给持票设备(见 §4d 与 M4)。

## 3. 总体架构

四个组件:**移动壳**(手机浏览器 PWA)、**配对插件**(host 半 + 桌面 GUI 半)、**relay**(VPS 哑转发)、**认证代理**(配对插件 host 半的 LAN 形态)。dsh web server 永远绑 127.0.0.1,不改动。

### 3.1 relay 模式(兜底,任何网络可通)

```
┌ 手机 ──────────┐        ┌ VPS(杭州阿里云)──────────┐        ┌ 电脑(dsh host)────────────────────┐
│ 移动壳 PWA      │ ①WSS   │ relay:哑 WS 房间转发       │ ②WSS   │ 配对插件 host 半                     │
│ + NaCl carrier │◀───────▶│ relay.noirbright.top:443  │◀──────▶│  ├ NaCl 终止 / 设备令牌管理         │
└──────┬─────────┘ (TLS)   │ Caddy 自动 TLS            │ (TLS)  │  ├ Curve25519 密钥对($DSH_HOME)    │
       │                   │ 不可信:只见密文/房间号     │        │  └ /pair QR 路由(仅回环)          │
       │                   └────────────────────────────┘        └──────────┬───────────────────────┘
       │                                                                    │ 回环 HTTP(Host=127.0.0.1)
       │ ◀═════════ ③ NaCl box 端到端;relay 不解读帧内容 ═══════════════════▶│
       │                                                          ┌─────────┴────────┐
       │                                                          │ dsh web          │
       │                                                          │ 127.0.0.1:3080   │
       │                                                          └──────────────────┘
```

加密边界:①②为 WSS 传输加密(手机⇄relay、host⇄relay 各一段 TLS);③为 NaCl box 端到端,明文边界在手机与配对插件 host 半,relay 只见密文。relay 房间协议见 relay-protocol.md。

### 3.2 LAN 直连模式(同一 Wi-Fi,零第三方)

```
┌ 手机 ────────┐   明文 HTTP/WS + Bearer token    ┌ 电脑(dsh host)───────────────────────┐
│ 移动壳        │   (WS 认证走 subprotocol)       │ 认证代理(配对插件 host 半的 LAN 形态) │
└──────────────┘◀────────────────────────────────▶│   绑 LAN 地址,如 192.168.x.x:<port>   │
                                                  └──────────────────┬────────────────────┘
                                             Host 改写为 127.0.0.1  │ 回环
                                             (上游 fence 天然通过) ┌─┴─────────────────┐
                                                                   │ dsh web           │
                                                                   │ 127.0.0.1:3080    │
                                                                   └───────────────────┘
```

### 3.3 桌面 GUI 半

配对插件的 client 半挂进上游 web GUI(设置页入口「配对手机」),从 `/pair` 路由(仅回环,围栏保证)取 payload,渲染二维码与已配对设备列表。二维码显示在桌面端,手机扫码。

## 4. 组件设计

### 4a 移动壳(方案 3b)

- **形态**:移动 Web(PWA),浏览器打开即用;v1 不做原生壳。容器决策(WebView/Capacitor)与前端适配正交,留待开放问题。
- **构成**:独立目录里一个 bundle 包 + 一个 `ui-layout-mobile` 包 + 自己的构建入口,依赖上游 public npm 包(架构事实 6)。
- **bundle 的 patch**:`disabled` 掉 `dsh-client-ui-layout` 与桌面专属插件(如 native 目录选择器),挂载 `ui-layout-mobile`;其余 `dsh.client` 行原样继承上游 web profile(架构事实 4、5)。
- **ui-layout-mobile**:注册进内建 `'root'` slot,**声明与上游相同的子 slot 名**(`'sidebar'`、`'shell.overlay'` 等 4 个,架构事实 2),内部为单栏布局 + 抽屉/底部导航 + 自有全局样式(自己的代码,不是覆盖上游)。leaf 插件(ui-conversation、ui-tool、ui-input 等)原样复用——上游迭代最快的部分零成本跟进。
- **维护面** = 上游 ui-layout 的 slot 声明契约(当前 4 个子 slot),不是整个 UI;契约漂移在加载期 fail-loud(架构事实 3),升级时立即可见。
- **版本策略**:pin 上游 0.1.0-rc.x,按 release 升级;每次升级的检查项 = ui-layout 的 slot 声明 diff + 复用 leaf 清单 diff。上游预发布期无兼容承诺(架构事实 9),这是主要风险,靠 pin 与 fail-loud 兜住。
- **样式**:自己的 CSS Modules + `--dsw-*` token(主题包同为 public 包);不尝试覆盖上游组件内部样式(hash 类名不可靠,架构事实 10)。
- **伺服**:LAN 模式下移动壳 dist 由认证代理伺服(同源零配置);relay 模式下由 VPS 伺服(见 §4c),手机经 QR 打开一次即可。

### 4b 配对插件(名字草案 dsh-mobile-pair)

**host 半**(Node 插件,挂进 dsh profile):

- **持久 Curve25519 密钥对**:首次启动生成,存 `$DSH_HOME`(借鉴 Paseo 的 `daemon-keypair.json`);公钥即配对信任锚。
- **`/pair` payload 路由**:注册在回环 dsh web 上,只有本机桌面 GUI 能取(架构事实 7 的围栏)。
- **一次性配对码**:短时效(草案 5 分钟)、一次性、桌面端可重新生成;QR 泄露的补救 = 重新生成或重启轮换(借鉴 Paseo)。
- **设备令牌管理**:配对码换长期 device token;令牌表持久化、可吊销(v1 即带吊销,成本低收入高)。
- **两种暴露形态**:LAN 认证代理(§4d)与 relay 连接器(出向 WSS + NaCl 终止)。一个插件两扇门,背后都是回环的 dsh web——对称设计。
- **E2E(relay 模式)**:QR 携带 daemon 公钥;手机经 relay 房间发来自己的公钥握手;双方 ECDH 出共享密钥;之后全部帧用 NaCl box(XSalsa20-Poly1305);握手完成前不接受任何命令;每会话派生新密钥防重放。整套流程照搬 Paseo 已验证的设计。

**桌面 GUI 半**(client 插件,挂进上游 web GUI):设置页入口「配对手机」,取 `/pair` payload,渲染 QR + 设备列表(吊销按钮)。QR 显示在桌面端,手机扫码。

**QR 内容(草案)**,秘密用 URL fragment 承载(浏览器不把 fragment 发给服务器,日志与抓包不见——借鉴 Paseo 的 `app.paseo.sh/#offer=...`):

```
https://app.noirbright.top/#offer=base64url({
  v: 1,
  mode: "lan" | "relay",
  addr:   可达地址(LAN IP:port,或 wss://relay.noirbright.top),
  room:   relay 房间号(mode=relay 时),
  pubkey: daemon Curve25519 公钥,
  code:   一次性配对码,
  exp:    过期时间
})
```

`addr` 即插件 Config 的 `advertiseUrl` 语义:同网段自动推导 LAN IP、有 tailnet 用 tailnet 地址、都不满足回落 relay;**三种连接模式共用一个配对流程与一个 QR 格式**。

### 4c relay(名字草案 dsh-mobile-relay)

- **部署**:用户自有 VPS——杭州阿里云 `120.26.124.92`(`ssh vps-aliyun`,root 密钥登录);域名 `noirbright.top` 已完成 ICP 备案(用户确认),A 记录已指向该 VPS(经 DoH 实测),DNS 托管在阿里云解析;子域 `relay.noirbright.top` 待添加。VPS 上已有 Web 服务在 80 端口运行。杭州机房对手机与家庭网络延迟都低;E2E 设计下放境内无数据顾虑。
- **形态**:Caddy 自动 TLS(Let's Encrypt)下的哑 WebSocket 房间转发;Node 实现,一两百行量级;可参考开源的 getpaseo/paseo-relay(Elixir)。VPS 配置要求极低。
- **不可信设计**:relay 不解读帧内容,帧即 NaCl box 密文;relay 只能观察到 IP、时序、帧大小、房间号(同 Paseo 威胁模型);VPS 上不存放任何密钥,被攻破也不泄露内容。协议细节见 relay-protocol.md。
- **端口**:标准 443(域名已备案),`wss://relay.noirbright.top`。443 的证书状态需在 M0 部署时确认(立项讨论中从沙箱的探测受本地代理干扰,结论不可靠);若 443 有障碍,退路是非标端口(如 8443,安全组已开),QR 格式不变。
- **移动壳 PWA 托管**:同 VPS(如 `app.noirbright.top`,Caddy 加一个站点),手机经 QR 打开。

### 4d 认证代理(LAN 模式)

- **位置**:配对插件 host 半的一部分;dsh web 永远绑 127.0.0.1,代理绑 LAN 地址,是 LAN 侧唯一入口。上游 server 不暴露、不改动。
- **转发**:node:http 反向代理,HTTP 与 WS upgrade 全覆盖(`/api`、events.mux、events.host、SPA 静态资源、插件 bundle),一个入口罩住全部路由;转发时 Host 改写为 `127.0.0.1:3080`,上游围栏视为回环、天然通过(架构事实 7)。手机加载后与代理同源,移动壳不需要任何服务器地址配置。
- **认证**:HTTP 走 `Authorization: Bearer <device token>`;**WS 走 Sec-WebSocket-Protocol subprotocol 认证,不用 query param**(避免 token 进 URL 落日志——借鉴 Paseo);未认证一律 401/拒绝握手,仅健康检查端点豁免(借鉴 Paseo 的 `/api/health` 豁免)。
- **明文边界**:LAN 内明文 HTTP + token,定位等同 Paseo 的"密码直连"——管访问不管加密;要加密走 relay 模式或 Tailscale。
- **已知收窄项(M4)**:代理把回环特权方法集(`host.openPath`、settings/credentials 写面等,架构事实 11)间接暴露给持票设备;v1 约定持票设备即可信设备,M4 加代理侧方法白名单收敛。

## 5. 连接模式三级回落

原理:跨网通信要求至少一端可被对方直接够到,或存在一个双方都够得到的第三节点——这是 NAT 决定的约束,不是设计选择。relay 是唯一在任何网络(蜂窝 CGNAT、公司网、酒店 Wi-Fi)下都保证能通的方案。

QR 的 `addr` 按优先级回落:

1. **LAN 直连**:手机与电脑同网段 → `addr` = LAN IP。零第三方;明文 + token(§4d)。
2. **Tailscale / IPv6**:用户自备可达性 → `addr` = tailnet 地址或全球 IPv6。relay 不必启动;Tailscale 免费层是"感觉不到服务器"的近似答案,IPv6 是真无第三方但配置门槛高。
3. **relay 兜底**:`addr` = `wss://relay.noirbright.top` + `room`。两端均出向连接,NAT 免疫,且 E2E 加密(§3.1)。

三级共用一个配对流程;relay 从必需品降级为兜底。

## 6. 从 Paseo 借鉴的清单

来源:[paseo.sh/docs/security](https://paseo.sh/docs/security)、[/docs/cli](https://paseo.sh/docs/cli)、[/docs/why](https://paseo.sh/docs/why);relay 实现 [getpaseo/paseo-relay](https://github.com/getpaseo/paseo-relay)(开源 Elixir)。

**直接照搬**:

1. **QR 即信任锚**:QR 携带 daemon 公钥,秘密不在线交换;"treat it like a password"。
2. **ECDH → NaCl box**:Curve25519 ECDH 出共享密钥,XSalsa20-Poly1305 加密全部消息;握手完成前不接受任何命令;每会话新密钥防重放;daemon 密钥对持久保存。
3. **fragment 承载秘密**:配对链接用 `#offer=...`,秘密不进服务器与日志。
4. **WS subprotocol 认证**:不用 query param。
5. **不可信 relay + 出向连接**:daemon 出向连 relay,两端在房间会合;relay 只见 IP/时序/大小/会话号;relay 是哑管道、可自建。
6. **网络暴露 opt-in**:Paseo 的 relay 默认关闭、配对时显式询问;我们的 LAN 绑定与 relay 连接同样做成显式开启。
7. **健康检查豁免**:唯一免认证端点,供监控。
8. **静态资源与 API 分离**:Paseo 放开静态文件让登录页渲染、API 仍要认证;移动壳 PWA 的静态资源同样不设防,但 `/api` 与 WS 必须认证。

**对照(不照搬)**:

- **Paseo 手机端用 React Native 而非 WebView**("Remote access isn't an add-on")。我们选移动 Web 壳:我们能复用上游 leaf 插件(Paseo 全自建,没有这个机会),维护成本最低。代价是 UX 天花板(手势/推送/语音输入/后台存活),以及 relay 模式需自实现 NaCl carrier(架构事实 8 使其可行)。是否升级原生壳见 §8。
- Paseo 的 daemon 是全自研服务;我们的"daemon 侧"是挂进 dsh profile 的插件,复用上游 webserver/connection,不另起服务。

## 7. 里程碑

- **M0 relay PoC**(不依赖 dsh):VPS 上加 `relay.noirbright.top` 站点(Caddy 签证书,确认 443 状态)+ 最小 WS 房间转发;两台跨网浏览器经房间互发消息。验证:443 通路、证书、转发时延、房间语义。
- **M1 LAN 配对**:配对插件 host 半(密钥对、`/pair` 路由、认证代理、token 签发/吊销)+ 桌面 GUI 半 QR。手机同 Wi-Fi 扫码,打开的是上游桌面 GUI(移动壳此时尚不存在)——先验证配对与认证通路。
- **M2 移动壳骨架**:bundle + `ui-layout-mobile`(单栏 + 抽屉/底栏),声明上游同款子 slot 名,接通会话列表与对话页(leaf 复用);LAN 模式下可用。
- **M3 relay 模式 + E2E 载体**:移动壳侧实现 NaCl carrier(实现 `AbstractApiClient`/双流抽象,架构事实 8),host 半做 NaCl 终止与 relay 连接器,QR 三级回落上线;外网可用。
- **M4 设备管理与加固**:设备列表/吊销 UI 完善、代理侧方法白名单(架构事实 11 的收窄)、速率限制与审计日志、配对码轮换策略、relay 房间加固。

## 8. 开放问题

1. **移动壳功能裁剪范围**:设置、工作流、trajectory 等 leaf 裁掉多少;审批(permission/ask-user)在手机端的交互形态。
2. **是否最终需要原生壳**:推送通知、语音输入、手势与后台存活的诉求积累到什么程度时值得引入 Capacitor/RN;届时移动壳哪些部分可以带走。
3. **relay 多用户化**:当前自用单实例;房间模型如何扩到多设备/多 daemon;是否需要一个公共 relay。
4. **桌面 GUI 半的挂载点**:设置页 tab 还是工具栏入口;上游 ui-settings 的 slot 扩展点需实测验证。
5. **移动壳 PWA 托管**:同 VPS 的 `app.noirbright.top`(当前草案)还是别处;与上游 rc 发布的版本联动。
6. **版本跟进的负责人与节奏**:上游预发布期变更快(架构事实 9),pin 升级的周期与每次升级的验证清单。