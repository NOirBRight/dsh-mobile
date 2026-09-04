# @dsh-mobile/ui-layout-mobile

移动端根布局:`dsh.client` 插件(platform web),注册进 web shell 内建的 `'root'` slot,**逐字实现上游 `@deepseek-ai/dsh-client-ui-layout` 的 slot 契约**,使全部 leaf 插件(ui-sidebar、ui-conversation 等)不经修改继续工作。布局本体是移动形态:单栏 + 顶栏(菜单按钮)+ sidebar 滑出抽屉 + details 全屏底部弹层 + 安全区内边距。维护者在 `dshapp` 上改本包时必须遵守 [docs/ops-dshapp-without-restarting-web.md](../../docs/ops-dshapp-without-restarting-web.md)：不重启 `dshweb` 的 Host，也不把本包做成第二套功能 UI 或独立设计系统。窄屏加号拦截后只弹出「命令 / 插入图片」；图片仍走 Host 官方的 draft-image 通道（PNG/JPG/WebP/GIF），不提供协议并不支持的任意文件上传入口。

## Slot 契约(本包的维护面)

以下来源:上游 `packages/client/ui-layout/src/client/index.ts` 的 `ctx.slots.register({ name: 'root', children, store, inject }, AppFrame)` 调用。升级上游版本时 diff 该文件;**契约漂移在加载期 fail-loud**(渲染未声明的 slot、或声明他人已声明的 slot,均在 load 时失败 —— packages/client/AGENTS.md「Slot and props discipline」)。

### 四条 children 声明(逐字,kind/scope 是运行时契约)

| slot | kind | scope | owner | 占用者 | 移动端语义 |
|---|---|---|---|---|---|
| `'sidebar'` | `single` | `root` | `{ collapsed: boolean; width: number }` | ui-sidebar SidebarRoot | 滑出抽屉本体;抽屉打开期间恒传 `collapsed: false`(不触发紧凑轨道 UI) |
| `'conversation'` | `single` | `session-maybe` | `{}` | ui-conversation ConversationRoot | 唯一内容栏(无会话 hero 与 live 对话两态) |
| `'details'` | `single` | `session` | `{}` | ui-conversation DetailsPanel | 全屏弹层;关闭时保持挂载(CSS 位移离屏) |
| `'shell.overlay'` | `list` | `root` | 无 | 各插件的浮层项 | 全框架浮动层,click-through,子项自行恢复 pointer-events |

### 契约的其余三条

1. **`ctx.layout` 服务面**(IMobileLayout,与上游 ILayout 逐方法一致):`toggleSidebar()` / `openDetails()` / `closeDetails()`。ui-sidebar 的折叠按钮、ui-conversation 的详情开关都调它;`app-shell` 伪入口 `inject: ['slots', 'sessions', 'layout']` —— **不提供该服务则 shell 永不就绪**(packages/client/web/src/app-shell.ts)。经 `ctx.reflect.provide('layout', controller)` 提供,bound actions 由 register 的 inject hook 接回。
2. **ThemePresenter**:ui-theme 只持有快照,把快照写到 document(body 的 palette 属性、token 内联变量、theme-color meta)的职责随根布局走。本包 `theme-presenter.ts` 是上游同名文件的逐字拷贝;两个布局同时挂载会导致双写,所以 bundle 必须禁用上游 ui-layout 行。
3. **插件 inject**:`['slots', 'theme', 'sessions', 'settingsScope', 'remote.agentPresets', 'modelDirectories']`；静态 `dsh.client.inject` 同时声明提供这些服务的 Host 客户端模块。

## 与上游的行为差异(有意为之)

- 桌面三栏/拖拽把手/ concession 链 → 移动单栏 + 抽屉 + 弹层;store 状态从 px 宽度简化为 `{ drawerOpen, detailsOpen }`。
- 会话切换时除关闭 details(上游行为)外**还关闭抽屉**(移动端导航即收起的惯例)。
- 抽屉打开时不传 `collapsed: true`,侧边栏的紧凑轨道 UI 在移动端永不出现。
- 上游暂未提供语义 seam、只能桥接本地化 ARIA 时，不得只匹配一种语言；当前上游中英文词典必须同时匹配，并由真实浏览器 fixture 固定两种 label 下的同一布局结果。
- 不得用控件已有的伪元素承载移动端文案；例如 View tab 的 `::after` 属于选中下划线，移动布局必须保留真实 tab 文本并通过间距分配解决宽度。
- 已知内置 preset 被用户层覆盖后可能携带非本地化 metadata；移动端只可按可证明的内置身份（`standard` / `ptc` / `minimal` / `cordis` 及其官方中英文全名）补齐紧凑文案。中文为「标准 / PTC / 极简 / 创造」，英文为「Standard / PTC / Minimal / Creator」；任意用户 preset 名称保持原样。
- 复用 Agent Presets 启用前遗留的空白会话时，移动端把 Host 默认 preset 写入该空白会话，使官方 Hero 模式选择器恢复显示；已有 preset 或已开始的会话不改动。
- 切换 Host 后若当前空白会话的默认模型 Provider 已不可路由，移动端优先把同名模型重映射到唯一有效 Provider，否则选择该 Host 目录中的首个有效模型；已开始的会话不自动改写。

## 静态加载修订号

`apps/mobile-web/src/manifest.ts` 的 `MOBILE_LAYOUT_REV` 是 dshapp/APK 为本地 layout bundle 使用的缓存失效号；它不是 DSH 版本，也不是本包 `package.json` 的语义版本。每次发布静态 `client.js` 时递增，确保浏览器请求新 URL。

## 构建

`npm run build` 先由 `prepare-upstream.mjs` 选定根目录 `.dsh-upstream`；Vite、tsdown、类型路径、Host bridge 构建与本地打包必须全部消费这一个 checkout，禁止各自回退到 sibling 路径。随后执行 tsc(emit lib/types)+ tsdown(node 半 lib/index.js + 浏览器闭包工厂包 lib/client.js)。tsdown 预设在本仓库 `build/tsdown.client.ts`(上游 packages/client/tsdown.client.ts 的适配拷贝,PLATFORM_MODULES 指向上游 checkout)。浏览器包外部化 PLATFORM_MODULES + `@deepseek-ai/dsh-client-runtime/client`(运行时由 shell 的模块表应答),其余依赖内联并过 purity gate。

## 同步策略

跟随 PLAN.md §4a:pin 上游版本;升级时 diff 上游 ui-layout 的 `src/client/index.ts`(四条声明)、`theme-presenter.ts`、`service.ts` 的 ILayout;加载期的 fail-loud 校验保证漂移立刻暴露。


## Release installation

The signed [dsh-mobile v1.1.5](https://github.com/NOirBRight/dsh-mobile/releases/tag/v1.1.5) APK carries this layout locally. It replaces the official root only in the mobile shell's narrow boot manifest; do not add it to a desktop-only WebUI profile, where that would replace the official desktop root.

For a custom mobile shell, the fixed-name artifact is available from the same Release:

```sh
# Latest (version-free)
dsh plugin --profile web add --force https://github.com/NOirBRight/dsh-mobile/releases/latest/download/dsh-mobile-ui-layout-mobile.tgz

# Fixed version
dsh plugin --profile web add --force https://github.com/NOirBRight/dsh-mobile/releases/download/v1.1.5/dsh-mobile-ui-layout-mobile.tgz
```

Verify with `dsh plugin --profile web list` and `dsh plugin --profile web doctor`; uninstall with `dsh plugin --profile web remove @dsh-mobile/ui-layout-mobile`. This private mobile-shell package targets DeepSeek Harness `0.1.2-alpha.4` and intentionally has no sibling source, `link:`, `workspace:`, or absolute-path dependency. Release bytes and checksums are emitted with the Alpha.4 mobile release. Roll back by restoring the prior mobile-shell bundle and rerunning its fixed command; restart only after the shell manifest validates.
