# @dsh-mobile/bundle-mobile-web

移动浏览器表面 bundle:manifest 声明 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`,作为可安装的 patch 层叠加在 `dsh-web-app` 层之上;包根导出 `mobile-web-runtime` 胶水插件。

## patch 层做的两件事

1. **换根布局**:`disabled` 上游 `ui-layout` 行,插入 `@dsh-mobile/ui-layout-mobile` 的 `dsh.client` 行。四条子 slot 声明逐字一致(契约见 `packages/ui-layout-mobile/README.md`),leaf 插件原样工作。
2. **换 dist**:见下节结论。

## dist serve 结论(关键未知点的答案)

**可行,且不需要碰上游。** 调查链路与证据:

- `dsh-host-frontend-static` 的 Config 就是 `{ distIndex: string }`(index.html 的绝对路径;packages/host/frontend-static/src/index.ts L28-35)——**支持指定 dist 路径**。
- 但上游不由部署直接配置它:`dsh-web-app` 胶水内部 `createRequire(import.meta.url).resolve('@deepseek-ai/dsh-web-frontend/dist/index.html')`(packages/bundle/web-app/src/index.ts `resolveDistIndex`,L116-124),其 Config `{printUrl, surfaceContext, trustedHosts}` **没有 dist 覆盖口**;且 fallback 席位单主(重复注册抛错),不能再挂第二个 frontend-static 而不处理上游那行。
- 因此本 patch:`disabled` `web-runtime` 行 → 本包胶水行接替提供 `webRuntime` 服务(connection 行的 `!!js ctx.webRuntime.trustedHosts` 依赖它)→ 插入一行 `frontend-static`,`distIndex` 直指 `apps/mobile-web` 的产物。

曾考虑并放弃:覆盖 web-runtime 的 config(无此口);shadow `@deepseek-ai/dsh-web-frontend` 包名(解析锚定在上游仓库内,out-of-tree 无法介入);复制整个胶水(复制面过大)。

## 已知取舍(M2 骨架)

- 上游 `web-runtime` 行还承担 `harness:source`/`app:web-surface` 提示词段与 `DSH_WEB_URL` shell 变量,本层**不复制**(移动表面不需要桌面 GUI 的"this page"指引;需要时在胶水补)。
- `distIndex` 是写死的绝对路径,换机器需调整;上游哲学是"组装事实,永不用户配置",这里同理,只是组装方换成了本仓库。
- 胶水刻意零上游运行时 import(out-of-tree 解析安全);Config 校验为手写(不带 schemastery 依赖),load 期 fail-loud。

## 安装与启动(开发期)

~~~sh
# 1. 构建本仓库(npm workspaces;首次先 npm install)
cd /home/noirbright/Workstation/dsh-mobile
npm_config_cache=/tmp/.npm-cache npm install
npm run build        # ui-layout-mobile → bundle 胶水 → mobile-web dist

# 2. 建独立 profile 并把本 bundle 装进去(dsh plugin 是 pnpm 转发器,接受本地路径;
#    首次使用自动以 dsh-base 模板初始化 profile)
#    注意:若 pnpm dsh 包装器被 pnpm 11 的 verifyDepsBeforeRun 卡住,绕过它:
#    node --import tsx/esm apps/cli/src/bin.ts plugin --profile mobile-web add <路径>
cd /home/noirbright/Workstation/deepseek-harness
node --import tsx/esm apps/cli/src/bin.ts plugin --profile mobile-web add /home/noirbright/Workstation/dsh-mobile/bundle/mobile-web

# 2a. link: 语义不安装被链接包的依赖,因此 ui-layout-mobile 需要单独加为 profile 依赖:
cd ~/.dsh/profiles/mobile-web
pnpm add /home/noirbright/Workstation/dsh-mobile/packages/ui-layout-mobile

# 3. 新 profile 的层栈默认只有 [dsh-base, 本 bundle];把 dsh-web-app 补进中间。
#    编辑 ~/.dsh/profiles/mobile-web/package.json:
#    "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@dsh-mobile/bundle-mobile-web"] } }
#    (in-box bundle 从 dsh 安装解析,无需安装;本 bundle 与其依赖已被 pnpm 链接进 profile)

# 4. 启动(避开日常 web profile 的 3080 端口;3081 在本机也被占用,用 3082)
node --import tsx/esm apps/cli/src/bin.ts --profile mobile-web --port 3082

# 5. 验证
curl -s http://127.0.0.1:3081/ | grep -o "DSH Mobile"          # 移动壳 index
curl -s http://127.0.0.1:3081/ | grep -o "ui-layout-mobile"     # 移动布局进了 __DSH_BOOT__ 花名册
~~~

手机访问局域网/公网入口是配对插件与认证代理(M1)的职责;M2 骨架先验证 loopback。

## 卸载

~~~sh
pnpm dsh plugin --profile mobile-web remove @dsh-mobile/bundle-mobile-web
# 或直接删除整个 profile 目录 ~/.dsh/profiles/mobile-web
~~~
