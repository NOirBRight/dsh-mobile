# 部署拓扑(VPS:120.26.124.92,杭州阿里云)

dsh-mobile 在 VPS 上的全部设施,均为 docker 容器,挂在用户已有的 `vps-net` 网络上,由其 Caddy 容器(`infodigest-caddy`)统一入口并自动签发 LE 证书。

| 入口 | 容器 | 内容 | 部署 |
|---|---|---|---|
| `wss://relay.noirbright.top` | `dsh-relay` | E2E 密文房间中继(relay/server.js) | `relay/deploy/deploy.sh` |
| `https://app.noirbright.top` | `dsh-mobile-web`(nginx + volume `dsh-mobile-web`) | 移动壳 PWA 静态文件 | `apps/mobile-web/deploy/deploy-app.sh` |

兼容入口:`wss://noirbright.top/relay`(同 relay,路径形式)。

## 运维要点

- **Caddyfile 是单文件 bind mount**:替换宿主文件(mv/sed -i)会变 inode,容器读到旧内容。改法:宿主文件原地改(append 或 `cat new > file`),再 `docker cp` 进容器 +`caddy reload --config /tmp/<copy>`。宿主文件已是终态,容器重启亦安全。
- **文件权限**:本机 umask 077,rsync -a 会把 0600 带到 VPS;nginx 卷内必须 `chmod -R a+rX`(deploy-app.sh 已含);Docker 构建上下文同理(Dockerfile 用 `COPY --chmod=644`)。
- **DNS**:A 记录经 VPS 上的 `aliyun alidns` CLI 管理(已配好凭证)。
- 证书:Caddy 自动 tls-alpn-01 签发,域名已备案。
