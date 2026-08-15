# 部署拓扑(VPS:120.26.124.92,杭州阿里云)

dsh-mobile 在 VPS 上的全部设施,均为 docker 容器,挂在用户已有的 `vps-net` 网络上,由其 Caddy 容器(`infodigest-caddy`)统一入口并自动签发 LE 证书。

| 入口 | 容器 | 内容 | 部署 |
|---|---|---|---|
| `wss://relay.noirbright.top` | `dsh-relay` | E2E 密文房间中继(relay/server.js) | `relay/deploy/deploy.sh` |
| `https://app.noirbright.top` | `dsh-mobile-web`(nginx + volume `dsh-mobile-web`) | 移动壳 PWA 静态文件 | `apps/mobile-web/deploy/deploy-app.sh` |

兼容入口:`wss://noirbright.top/relay`(同 relay,路径形式)。

## profile 组合的两个硬性要求

- **花名册必须覆盖全部会写 session 事件的插件**。session 日志按设计 fail-loud:组合不认识的事件类型(非 ignorable)会拒绝解读整个日志(SessionFormatUnsupportedError)。手机 profile 缺了 codex-connect 时,含 web/openai-codex-search-llm-request 事件的会话全部打不开——对齐日常 profile 的 bundles 与对应 config 行即可(2026-08-15 实例)。
- **profile 的 pnpm-workspace.yaml 需要 autoInstallPeers: false**(从日常 profile 拷贝)。否则 pnpm 会去 npm 拉 @deepseek-ai/* 的 peer 依赖,未发布的一串 404(dsh-environment、dsh-type-meta……);dshmarket 这类外部包要钉精确版本(1.4.1),浮动版本会拖进新的未发布依赖。

## 运维要点

- **Caddyfile 是单文件 bind mount**:替换宿主文件(mv/sed -i)会变 inode,容器读到旧内容。改法:宿主文件原地改(append 或 `cat new > file`),再 `docker cp` 进容器 +`caddy reload --config /tmp/<copy>`。宿主文件已是终态,容器重启亦安全。
- **文件权限**:本机 umask 077,rsync -a 会把 0600 带到 VPS;nginx 卷内必须 `chmod -R a+rX`(deploy-app.sh 已含);Docker 构建上下文同理(Dockerfile 用 `COPY --chmod=644`)。
- **DNS**:A 记录经 VPS 上的 `aliyun alidns` CLI 管理(已配好凭证)。
- 证书:Caddy 自动 tls-alpn-01 签发,域名已备案。
