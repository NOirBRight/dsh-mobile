# dsh-relay

不可信 WebSocket 房间中继:dsh-mobile 手机端与家中 DSH 主机之间的 E2E 密文哑管道。

- 帧内容对 relay 是 NaCl box 密文,relay 不解读、不记录,只转发;房间号(128 位随机,来自配对 QR)即唯一能力凭证。
- 路由:GET /healthz;WS /r/<roomId>?role=host|client(每房间恰好两方,第三方 4409;单方离开不拖垮对端,便于手机漫游重连)。
- 部署:VPS 上 deploy/deploy.sh 构建容器(加入 vps-net),并在 Caddy 的 noirbright.top 站点挂 handle_path /relay*。外部入口 wss://noirbright.top/relay。
- 本地:npm install && npm test(行为测试);RELAY_URL=... node test/e2e-wss.mjs(端到端)。
