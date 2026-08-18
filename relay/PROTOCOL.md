# dsh-signaling 房间协议 v1

## 信任边界

服务端不被信任。它可见连接 IP、房间号、时序和 SDP 中的 ICE candidate，但没有 Host 私钥、device token 或 DSH 明文。端点身份由 DataChannel 打开后的 NaCl hello/ack 验证。

恶意信令服务可以拒绝服务或替换 SDP；替换后的 endpoint 无法通过 QR Host 公钥认证。

## 连接

~~~text
wss://relay.noirbright.top/r/<roomId>?role=host|client
~~~

roomId 是 16 随机字节的小写 hex。每房间一个 host、一个 client。空房十分钟回收；单方离开时另一方保留。

## 唯一允许的消息

~~~json
{"type":"signal","phase":"sdp","payload":"<base64url>"}
~~~

payload 解码后是：

~~~json
{"kind":"offer|answer","description":{"type":"offer|answer","sdp":"..."}}
~~~

服务端拒绝 hello 和其他 phase；它解码 payload 并校验 client 只能发送 offer、host 只能发送 answer、description.type 匹配且 SDP 以 v=0 开始。

## 强制限制

- WebSocket binary frame：4400。
- 不符合 envelope 的 text：4400。
- payload 非 base64url、消息超过 64 KiB、每分钟超过 64 条：4400。
- 房间满或 role 冲突：4409。
- 不缓存、落盘或重放消息。对端未连接时消息不会排队。

SDP 完成后信令连接可以空闲保持，用于占有唯一 role 并与当前 peer 生命周期绑定；它不会承载更多数据。Tunnel/DataChannel 关闭时 client 同时关闭 PeerConnection 与 signaling socket，释放房间席位。Host campaign 保持在线以接受设备重连。所有 NaCl handshake 和 DSH traffic 都只走 RTCDataChannel。
