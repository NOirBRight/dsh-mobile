# @dsh-mobile/pairing

dsh-mobile 的配对插件(host 半),out-of-tree 挂进 dsh profile,不修改上游任何文件。设计依据见 [PLAN.md](../../PLAN.md) §4b/§4d 与 [relay/PROTOCOL.md](../../relay/PROTOCOL.md)。

## 功能

1. **持久 Curve25519 密钥对**(`src/keys.ts`):首次启动生成 X25519 密钥对,存 `<dshHome>/mobile/daemon-keypair.json`(mode 0600);公钥即配对信任锚。文件损坏时 fail loud,绝不静默轮换身份。
2. **/pair 路由族**(`src/index.ts`,注册在上游回环 webserver 上,只有本机可达——上游 fence 保证):
   - `GET /pair` → 配对载荷 `{ v, mode, addr, room, pubkey, code, exp }` + `offerUrl`;`?format=svg` 返回 QR 的 SVG。每次调用铸造新配对码。
   - `POST /pair/exchange` `{ code, label? }` → `{ deviceId, deviceToken }`。配对码**一次性、默认 5 分钟有效**,无论成功与否出示即焚。
   - `GET /pair/devices` → 设备列表(不含令牌哈希);`POST /pair/revoke` `{ id }` → 吊销。
3. **QR 输出**:offer URL 用 fragment 承载秘密(`<appUrl>#offer=<base64url(JSON)>`,借鉴 Paseo,浏览器不把 fragment 发给任何服务器)。无 GUI 时:`node scripts/pair-qr.mjs --live`(从运行中的 dsh 取真实载荷)或 `node scripts/pair-qr.mjs`(离线临时载荷,仅用于格式/视觉检查,其配对码在本进程外不可兑换)。
4. **认证反向代理**(`src/proxy.ts`):绑 LAN(默认 `0.0.0.0:0` 随机端口,启动日志打印实际端口)。HTTP 校验 `Authorization: Bearer <deviceToken>`;WebSocket 走 subprotocol 认证(`dsh-mobile.<token>`,不进 URL、不落日志;代理在 101 里回选该 subprotocol,但绝不转发给上游)。通过后 Host 改写为 `127.0.0.1:<dshPort>` 透明转发(含 WS upgrade 双向管道),上游 fence 视为回环天然通过。未认证一律 401,仅 `/healthz` 豁免。
5. **设备令牌**(`src/tokens.ts`):文件只存 SHA-256 哈希(明文只在签发时出现一次),原子写入,mode 0600,支持吊销。

## Config(cordis.yml,全部可配,schema + resolve 双层 fail-loud)

| 键 | 默认 | 说明 |
|---|---|---|
| `appUrl` | `https://app.noirbright.top/` | QR 指向的移动壳地址(M2 才存在) |
| `advertiseUrl` | 未设 → 推导 `http://<首个 LAN IPv4>:<代理端口>` | offer 的 `addr`;relay 模式填 `wss://...` |
| `bind` / `port` | `0.0.0.0` / `0` | 代理绑定地址;0 = OS 分配 |
| `dshHost` / `dshPort` | `127.0.0.1` / `3080` | 上游 dsh web;代理只转发到回环 |
| `dshHome` | `$DSH_HOME` 或 `~/.dsh` | 存放密钥对与设备库 |
| `keyStorePath` / `tokenStorePath` | `<dshHome>/mobile/...` | 显式覆盖 |
| `codeTtlMs` | `300000` | 配对码寿命 |

挂载示例(cordis.yml overlay):`- id: dsh-mobile-pairing\n  name: '@dsh-mobile/pairing'`(config 省略即全默认)。

## 测试

```sh
npm install   # 如 npm 写 home 失败:npm_config_cache=/tmp/.npm-cache npm install
npm test      # 22 个行为测试,node:test + node 类型剥离,无需构建、无需 dsh、无需 DEEPSEEK_API_KEY
npm run typecheck && npm run build
```

覆盖:无 token/错 token/已吊销 401;Bearer 通过且 Host 改写回环、credential 头不过代理;POST 流式;WS 无 subprotocol/错 token 拒握手、正确 subprotocol 连通回显且上游看不到 auth subprotocol;配对码一次性 + 过期;密钥对与设备库持久化、0600、损坏 fail loud;offer URL fragment 往返;QR SVG/终端渲染。

## 未验证项(如实声明)

- **与上游的真实组装未验证**:本环境没有把插件挂进真实 dsh profile 运行过。验证步骤:① 在上游 web profile 的 overlay 里挂载本包;② `pnpm dsh --profile web` 启动;③ `curl http://127.0.0.1:3080/pair` 应返回载荷;④ `node scripts/pair-qr.mjs --live` 出码;⑤ 手机同 Wi-Fi 浏览器打开 `http://<电脑IP>:<代理端口>/`,带 `Authorization: Bearer` 头应加载上游 GUI(或直接验证 `curl -H "Authorization: Bearer <token>" http://<IP>:<port>/healthz` 之外的路由)。
- `ctx.webServer` 的类型来自本地结构声明(npm 上 `dsh-host-webserver@0.0.1-rc.1` 的类型滞后于仓库源码,服务名已从 `httpServer` 改名 `webServer`);npm 类型追平后应改回 `import type {}` 增强。
- relay 连接器(出向 WSS + NaCl 终止)不在本包,属 M3;LAN 模式为明文 HTTP + token(定位同 Paseo 密码直连),要加密走 relay/Tailscale。
- 代理把回环特权方法面(`host.openPath`、settings/credentials 写面等)间接暴露给持票设备;M4 加方法白名单收敛(PLAN.md §4d)。
