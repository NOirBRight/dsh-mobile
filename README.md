# dsh-mobile

DeepSeek Harness 的手机客户端,独立项目:out-of-tree,不进入、不修改上游仓库(deepseek-harness),跟随其 release 升级。

- 规划与架构:[PLAN.md](PLAN.md)(目标、四组件、连接模式三级回落、里程碑)
- `relay/` —— 不可信 WebSocket 房间中继(M0,已部署):见 [relay/README.md](relay/README.md) 与 [relay/PROTOCOL.md](relay/PROTOCOL.md)
- `packages/ui-layout-mobile` —— 移动端根布局(M2):替换上游 ui-layout 的单栏抽屉壳,slot 契约逐字一致
- `apps/mobile-web` —— 移动壳 Vite 入口(构建 dsh-client-web shell 的 dist)
- `bundle/mobile-web` —— 移动浏览器表面 bundle(patch 层 + webRuntime 胶水),安装与启动验证见其 README

## 快速开始

~~~sh
npm_config_cache=/tmp/.npm-cache npm install
npm run build
~~~

启动 mobile-web profile 的完整步骤(含一次性 profile 初始化)见 [bundle/mobile-web/README.md](bundle/mobile-web/README.md)。

## 约定

- 包名 `@dsh-mobile/*`;npm workspaces(根 package.json `workspaces` 字段;选 npm 而非 pnpm:零额外工具、file:/workspace 协议无歧义)。
- 对上游的类型依赖一律走根 `tsconfig.base.json` 的 `paths`(指向上游已构建的 lib/types),**不使用 file: 依赖**——上游包内部互相用 `workspace:^` 协议,file: 链接进外部安装会炸。
- 默认上游 checkout 在兄弟目录 `../deepseek-harness`;否则设 `DSH_UPSTREAM`(apps/mobile-web 构建)并调整 tsconfig paths 与 bundle/mobile-web 的 distIndex。
