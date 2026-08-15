# dsh-mobile relay 房间协议(草案 v0)

relay 是部署在用户 VPS(杭州阿里云,120.26.124.92)上的哑 WebSocket 房间转发器,经 Caddy 自动 TLS 暴露为 `wss://relay.noirbright.top`(443)。本文档定义其房间协议;数值均为草案,随 M0 PoC 修订。

## 0. M0 实现现状(2026-08-15,与草案的差异)

M0 PoC 已在 VPS 部署并通过公网 E2E(wss://noirbright.top/relay)。实现的是本协议的子集:

- 入口为路径形式 wss://noirbright.top/relay(Caddy handle_path 去前缀);relay.noirbright.top 子域待加 DNS A 记录后切换。
- 已实现:双方房间(先到建房)、第三者 4409、binary/text 帧透明转发、空房 10 分钟 GC、30 秒 ping/pong 保活、单帧上限 1 MiB(ws 库以 1009 关闭)、/healthz 纯文本 ok、每 IP 每分钟 100 次升级限流。
- 未实现(留 M1+):text 控制消息与 binary/text 分工(§3.5、§5)、重连宽限与 4404/4408(§3.6)、4413(M0 以 1009 代替)、healthz JSON 计数、host 接入令牌。
- M0 的"单方离开不拆房、不通知"与 §3.6 草案不同,是有意为之:手机漫游重连不要求 E2E 层重建会话;§3.6 的宽限+控制消息方案在 M1 评审后取代。

## 1. 设计前提:不可信假设

- **relay 不解读帧内容**。转发的帧是 NaCl box(XSalsa20-Poly1305)密文;明文边界在两端的配对插件 host 半与移动壳。relay 不存放任何密钥。
- relay 可观察的元数据仅限:连接 IP、时序、帧大小、房间号(与 Paseo relay 的威胁模型一致,见 [paseo.sh/docs/security](https://paseo.sh/docs/security))。
- relay 被攻破的后果上限:拒绝服务、占座、元数据分析。它不能读出内容、不能伪造消息(NaCl 认证加密)、不能重放(每会话派生新密钥)、不能冒充任一端发命令(过不了 ECDH 握手)。
- 房间号是高熵能力令牌:知道房间号 ≠ 能通信(过不了握手),但可以占座和观察元数据。房间号按秘密处理,只经 QR 的 URL fragment 传递,不出现在任何日志中。

## 2. 连接 URL

```
wss://relay.noirbright.top/r/<roomId>?role=host|client
```

- `roomId`:128 bit 随机数,base64url 编码(22 字符),由配对插件 host 半在生成配对 offer 时铸造,经 QR 交给手机。
- `role=host`:dsh 侧(配对插件 host 半的 relay 连接器,出向接入);role=client`:手机侧(移动壳,出向接入)。
- `role` 缺失或非法、`roomId` 格式非法 → 关闭码 `4400`。

## 3. 房间规则

1. **每房间恰好两方**:一个 host、一个 client。
2. **先到者建房**:host 或 client 任一方先接入即创建房间并挂起等待对方;等待 TTL 草案 10 分钟,超时拆除房间。配对时序(QR 生成 vs 两端接入)因此无需耦合。
3. **第三者拒绝**:两方已满后再来任何接入,或同 role 重复占位(§4 重连宽限除外)→ 关闭码 `4409`,不转发任何帧。
4. **帧透明转发**:一方发来的帧原样转发给另一方。relay 不解析、不修改、不缓存;除保序外不提供任何语义。
5. **帧类型分工**:**binary 帧 = 对端应用流量**(NaCl 密文);**text 帧 = relay 自己的控制消息**(§5)。端发来的 text 帧一律以 `4400` 关闭,防止伪造控制消息。
6. **房间生命周期**:
   - 等待期(只有一方):10 分钟 TTL,过期拆除,后续接入按房间不存在处理(`4404`)。
   - 一方断开:房间进入重连宽限(草案 60 秒),另一方收到 `peer-left` 控制消息;宽限内同 role 重连恢复房间,向对方发 `peer-joined`;超时拆除,向留存方发 `room-closed` 后以 `4408` 关闭。
   - 两方都断开:立即拆除。
7. **消息大小上限**:单帧 256 KiB(草案);超限 → 关闭码 `4413`。帧与 dsh 流量的分片/多路复用由两端协议自定(见 §7),relay 只卡字节上限。
8. **速率加固(M4 项,非 M0)**:每连接帧率软限,超限丢帧并回控制消息;防止单房间打爆 VPS。

## 4. 错误码(WebSocket close code,使用 4000–4999 私有段,数值对齐 HTTP 助记)

| 关闭码 | 含义 | 触发 |
|---|---|---|
| `4400` | 请求非法 | role/roomId 非法;端发来 text 帧 |
| `4404` | 房间不存在或已过期 | roomId 从未存在,或等待 TTL 已过 |
| `4408` | 房间超时拆除 | 重连宽限结束(§3.6) |
| `4409` | 角色冲突/房间已满 | 第三者接入;同 role 重复占位 |
| `4413` | 帧过大 | 单帧超过 256 KiB |
| `1011` | relay 内部错误 | 未捕获异常;两端应退避重连 |

握手前的 HTTP 层错误(路径不存在等)按普通 HTTP 状态码回答,不升级。

## 5. relay 控制消息

text 帧,JSON,带保留字段 `"relay"`:

```json
{"relay": "peer-joined", "role": "client"}
{"relay": "peer-left", "role": "host"}
{"relay": "room-closed", "reason": "idle-timeout"}
```

两端实现的分工约定:binary 帧永远当作对端密文处理,text 帧永远当作 relay 控制消息处理;应用协议(NaCl 握手及之后的一切)只走 binary。

## 6. 健康检查

```
GET https://relay.noirbright.top/healthz
→ 200 {"ok": true, "rooms": <n>, "peers": <n>}
```

- 唯一免认证端点,供 VPS 监控/保活探测;计数不携带任何房间标识。
- relay 无应用层账号体系:**房间号即能力**(§1)。若后续需要防止陌生人大规模开房,加 host 侧接入令牌,列为 M4 加固项,不在 M0。

## 7. 握手之后(超出 relay 范围,仅衔接说明)

relay 对帧内容无感知;以下为两端在 binary 帧里的自有协议(详见 PLAN.md §4b):

1. client 接入房间后发送握手消息(含 client 公钥,以 QR 中的 daemon 公钥为信任锚);
2. host 验讫,双方 Curve25519 ECDH 出会话密钥;
3. 之后全部消息 NaCl box 加密;会话密钥每会话重新派生(防重放);
4. 明文载荷 = dsh web 的 HTTP/WS 流量的隧道封装:host 半 NaCl 终止后转发到回环 `127.0.0.1:3080`;多路复用与分帧格式随 M3 的 carrier 实现另行定义,不在本草案。