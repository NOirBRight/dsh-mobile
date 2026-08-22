> 已废弃：当前 `pair.noirbright.top` 有意连接 daily 3080/43170。本文只保留历史背景，禁止按原步骤把 3082/43169 接到该域名；请为 lab 使用独立 Custom Endpoint 或 Official Relay。

你在 AM01S 上执行 dsh-mobile 的 **PLAN 第 2 波运维切换**。不要重新规划架构。

权威文件（先读完再动手，不要把 ADR/PLAN 抄进回复）：
- `/home/noirbright/Workstation/dsh-mobile/docs/ops-lab-custom-cutover.md`（执行单，以它为准）
- `/home/noirbright/Workstation/dsh-mobile/PLAN.md` 第 2 波
- `/home/noirbright/Workstation/dsh-mobile/docs/adr/0005-vps-endpoint-tunnel-first-app-only.md`（只查决策，不改）

仓库：`/home/noirbright/Workstation/dsh-mobile`
本机 systemd --user。SSH 别名：`vps-aliyun`（国内）、`vps`（海外，仅在需要时）。

环境（不要弄反）：
- `3080` / `dsh-web.service` / 默认 `~/.dsh` = DSH 代码开发。禁止挂 pairing，禁止占用 `43169`。
- `3082` / `dsh-lab.service` / `DSH_HOME=~/.dsh-lab` = 全部 mobile 测试。Gateway 已在 `127.0.0.1:43169`。`pair.noirbright.top` 已反代到该端口。
- `~/.dsh-web` 不是当前 unit 家目录。`~/.dsh/mobile/public-endpoint.json` 与 3082 无关。

要做的唯一正活：让 3082 的 pairing 从 `endpointMode: quick` 改为 `custom`，`customEndpointUrl: https://pair.noirbright.top`，然后按执行单验收。公网隧道和 Caddy 已经在，不要重建 VPS 栈。

硬约束：
- 只改 `~/.dsh-lab/profiles/web/cordis.patch.yml` 的 pairing config；必要时只给 `dsh-gateway-vps-tunnel.service` 加 `After=dsh-lab.service`。不要 `BindsTo`。
- 不要改 `dsh-web.service`、不要给 3080 加插件、不要改 `dsh.noirbright.top` 的 Caddy。
- 不要改 APK / 客户端连接策略 / 去浏览器 / 缓存（PLAN 3–8 波）。
- 不要把 `pair.noirbright.top` 写进产品默认值。
- 不要提交应用代码，除非 custom 校验逻辑本身挡住了合法配置。
- 真机若已有同一 Host Identity 的旧 Quick Profile：Endpoint Refresh，不要当新 Host 重配。

完成后只交一份简报，包含：
1. 切前/切后：`3082 /pair/status`、`https://pair.noirbright.top/.well-known/dsh-mobile`、`ss` 上 `3080/3082/43169` 的 pid 与 `DSH_HOME`
2. lab 重启后是否还有 cloudflared
3. 真机结果（Tunnel 路由、心跳、重启后 token 重连）；若无真机，明确写未做以及本机已验证项
4. 改了哪些文件（完整路径）
5. 若未达目标：卡在哪一步、日志要点、你停手时的状态

现在开始：先按执行单做基线采集，再改 lab YAML。
