# @dsh-mobile/mobile-web

移动壳的 Vite + React 18 入口:构建 `@deepseek-ai/dsh-client-web` shell 的 dist,由 mobile-web profile 的 `frontend-static` 行 serve。只打包 shell;全部业务插件(leaf UI)在运行时经 host 的 client-module 扫描从 /plugins 到达,**不进入本 dist**。

## 依赖方式:源码别名,而非 npm/file 依赖

`npm view` 实测:上游 0.1.0-rc.5 未发布(npm 上是错位的 rc.2/rc.3/rc.6),且预发布期上游内部版本互相咬合——从 npm 混合解析必然错位。因此:

- **构建期**:`vite.config.ts` 把 `@deepseek-ai/dsh-client-web` 等 7 个包**别名到上游 checkout 的 src**(与上游 apps/web 的策略一致:浏览器 bundle 必须直接编译 src,CSS 才能走 vite 管线)。上游位置取 `DSH_UPSTREAM` 环境变量,默认 `../../deepseek-harness`(兄弟目录)。
- **类型期**:根 `tsconfig.base.json` 的 `paths` 指向上游已构建的 `lib/types/*.d.ts`。
- **运行期**:本 dist 只是壳;leaf 插件代码由 host 从它自己的安装里 serve——所以 host(上游 checkout)必须先 `pnpm run build` 过。

切换到 npm 依赖的条件:上游发布节奏稳定、且 `dsh-client-web` 及其全部传递依赖同版本发布后,删除别名、改为正常依赖即可(shell 包是纯库,无运行时上游文件依赖)。

## 构建

`npm run build` → `dist/`(`index.html` + assets)。bare `vite dev`/`vite preview` 被故意拒绝(与上游一致):只有 `dsh web` 系列会注入 `window.__DSH_BOOT__`。启动验证见 `bundle/mobile-web/README.md`。
