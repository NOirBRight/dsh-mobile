# dsh-signaling

不可信的 WebRTC 信令房间服务。它只在一个 Host 和一个 Android client 之间转发有界 SDP envelope；不会转发 NaCl tunnel frame、HTTP、WebSocket 或其他应用流量。

- HTTP：GET /healthz
- WebSocket：/r/<128-bit hex room>?role=host|client
- 第三个 peer 或重复 role：4409
- binary、任意其他 text、超限或超速信令：4400
- 单帧上限 64 KiB；每连接每分钟 64 个 signal

本地验证：

~~~sh
npm install
npm test
~~~

不要在该 VPS 部署 TURN，也不要恢复 binary 透明转发。
