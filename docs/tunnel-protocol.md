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

1. client 生成临时 X25519 对,发送**握手帧**:`clientPub(32B) || nonce(24B) || box(helloJson, hostPub, clientSec)`。helloJson = `{ code } | { resumeToken }`。
2. host 开封校验:`code` 有效且未用 → 焚毁并通过;`resumeToken` 有效 → 通过(见 §5);否则回复**明文错误帧** `{"error":"bad-code"|"expired"|...}`。**座位生命周期**:host 拒绝后必须保持座位不动(一条坏 hello 不能踢掉 host、DoS 房间);client 在握手的任何失败路径上都必须自己关闭连接,释放房间 client 座位。
3. 成功 → host 回复 `nonce(24B) || box(ackJson, clientPub, hostSec)`,ackJson = `{ ok: true, resumeToken: <新令牌> }`。会话开始。

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

## 5. 断线重连(resumeToken)

手机漫游/锁屏后 WSS 会断。ack 中的 `resumeToken`(随机、单次使用、10 分钟 TTL)替代 `code` 完成再次握手,无需重新扫码。host 侧令牌存内存即可(进程重启则重新扫码,可接受)。

## 6. 安全属性

- relay 可见:IP、时序、帧大小、房间号;不可见任何明文(与 PLAN.md §4c 不可信假设一致)。
- 握手帧本身密封(client→hostPub),relay 无法伪造 hello;code/resumeToken 防占座。
- host 静态私钥不出 $DSH_HOME;client 临时密钥每次连接重新生成,会话间无前向关联。
