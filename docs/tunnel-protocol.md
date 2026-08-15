# M3 隧道协议 v0(relay 模式)

配对插件(host 半)与移动壳(client)经 relay 哑转发建立的 E2E 加密隧道。所有与会话相关的帧均为 binary WebSocket 帧;relay 对内容无感知。加密原语:NaCl box(Curve25519 + XSalsa20-Poly1305),实现统一用 tweetnacl。

## 1. Offer(relay 模式,QR/fragment 承载)

JSON,经 `#offer=<base64url>` 传递:

```json
{ "v": 2, "mode": "relay", "addr": "wss://relay.noirbright.top",
  "room": "<128bit hex>", "pubkey": "<host X25519 pubkey, base64url>",
  "code": "<一次性配对码>", "exp": 1735689600 }
```

`pubkey` 是信任锚(PLAN.md §4b);`code` 一次性、5 分钟有效,防止"知道 pubkey 的旁观者占座"。

## 2. 握手(会话建立前,仅前两帧)

1. client 生成临时 X25519 对,发送**握手帧**:`clientPub(32B) || nonce(24B) || box(helloJson, hostPub, clientSec)`。helloJson = `{ code } | { deviceToken }`。
2. host 开封校验:`code` 有效且未用 → 焚毁并通过(首次配对);`deviceToken` 有效且未吊销 → 通过(已配对设备重连,见 §5);否则回复**明文错误帧** `{"error":"bad-code"|"expired"|"bad-token"}`。**座位生命周期**:host 拒绝后必须保持座位不动(一条坏 hello 不能踢掉 host、DoS 房间);client 在握手的任何失败路径上都必须自己关闭连接,释放房间 client 座位。
3. 成功 → host 回复 `nonce(24B) || box(ackJson, clientPub, hostSec)`。首次配对(code 路径)ackJson = `{ ok: true, deviceToken: <新设备令牌> }`;重连(deviceToken 路径)ackJson = `{ ok: true }`。会话开始。

## 3. 会话帧(全部密封)

明文为单个 JSON;`nonce(24B) || box(json, peerPub, ownSec)`。两类序号:**每方向独立 `seq` 从 0 递增**,接收方校验严格连续,乱序/重复/跳号 → 关闭连接(防 relay 重放与注帧)。

多路复用消息(`id` 由发起方铸造,连接内唯一):

| 类型 | 方向 | 语义 |
|---|---|---|
| `http-req {t,id,seq,method,path,headers,body?}` | c→h | `body` 为 base64;≤200KiB 单帧,更大用 http-data 续帧 |
| `http-data {t,id,seq,data,last}` | 双向 | base64 续帧,`last:true` 收尾 |
| `http-res {t,id,seq,status,headers,body?}` | h→c | 同 http-req 规则 |
| `ws-open {t,id,seq,path}` | c→h | 请求建立回环 WS(如 /api/events.mux) |
| `ws-ack {t,id,seq}` / `ws-err {t,id,seq,message}` | h→c | 建立成功/失败 |
| `ws-msg {t,id,seq,data}` | 双向 | base64 载荷 |
| `ws-close {t,id,seq,code?,reason?}` | 双向 | 任一侧关闭 |

host 侧收到 http-req 后向 `127.0.0.1:<dshPort>` 发真实请求(**Host 改写为回环**,上游 fence 天然通过),响应按帧回传;ws-open 同理建立到回环的 WS 并双向桥接。

## 4. 限制

- 单帧明文 ≤ 200 KiB;http body 上限 8 MiB(超出拒绝,插件 bundle 大文件走续帧)。
- 连接断开即会话结束;无帧级重传(TCP/WSS 已保序可靠,relay 不断帧)。

## 5. 断线重连(deviceToken,永久有效)

首次配对成功时,host 签发**持久设备令牌**:host 侧仅存 SHA-256 哈希(JSON 文件于 $DSH_HOME,0600,进程重启存活),手机存明文(localStorage)。之后所有重连以 deviceToken 完成握手——**永久有效,直到在设备列表中被吊销**(/pair/revoke,吊销即拒绝后续握手并使对应房间战役在退避周期内停止)。

安全论证:hello 全程密封(client 临时公钥加密到 host 公钥),relay 无法看到令牌;重放一条旧 hello 对攻击者无价值——会话密钥由 client 每次连接新生成的临时密钥对决定,重放者得不到任何可用会话。因此设备令牌可以是 bearer 形态,无需滚动轮换。

host 侧战役管理:配对窗口(exp,5 分钟)内战役等待首次配对;一旦某房间签发过设备令牌,该房间的 relay 战役随令牌存续而存续(host 记录设备→房间绑定,进程重启后为每个存活设备的房间恢复战役);吊销全部设备后战役停止。

## 6. 安全属性

- relay 可见:IP、时序、帧大小、房间号;不可见任何明文(与 PLAN.md §4c 不可信假设一致)。
- 握手帧本身密封(client→hostPub),relay 无法伪造 hello;code/resumeToken 防占座。
- host 静态私钥不出 $DSH_HOME;client 临时密钥每次连接重新生成,会话间无前向关联。
