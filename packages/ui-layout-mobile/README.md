# @dsh-mobile/ui-layout-mobile

移动端根布局:`dsh.client` 插件(platform web),注册进 web shell 内建的 `'root'` slot,**逐字实现上游 `@deepseek-ai/dsh-client-ui-layout` 的 slot 契约**,使全部 leaf 插件(ui-sidebar、ui-conversation 等)不经修改继续工作。布局本体是移动形态:单栏 + 顶栏(菜单按钮)+ sidebar 滑出抽屉 + rightbar 右侧滑入全屏层 + 安全区内边距。维护者在 `dshapp` 上改本包时必须遵守 [docs/ops-dshapp-without-restarting-web.md](../../docs/ops-dshapp-without-restarting-web.md)：不重启 `dshweb` 的 Host，也不把本包做成第二套功能 UI 或独立设计系统。窄屏加号打开官方命令 listbox（含 `file` /「文件」）；斜杠 skill 行补统一立方体图标。图片与文件走 Host 官方入口。

## Slot 契约(本包的维护面)

以下来源:上游 `packages/client/ui-layout/src/client/index.ts` 的 `ctx.slots.register({ name: 'root', children, store, inject }, AppFrame)` 调用。升级上游版本时 diff 该文件;**契约漂移在加载期 fail-loud**(渲染未声明的 slot、或声明他人已声明的 slot,均在 load 时失败 —— packages/client/AGENTS.md「Slot and props discipline」)。

### 四条 children 声明(逐字,kind/scope 是运行时契约)

| slot | kind | scope | owner | 占用者 | 移动端语义 |
|---|---|---|---|---|---|
| `'sidebar'` | `single` | `root` | `{ collapsed: boolean; width: number }` | ui-sidebar SidebarRoot | 滑出抽屉本体;抽屉打开期间恒传 `collapsed: false`(不触发紧凑轨道 UI) |
| `'main'` | `keyed` | `root` | none | ui-conversation ConversationPanel | center column; entryKey conversation |
| `'rightbar'` | `single` | `root` | width/viewport/canShow | ui-sidebar-right | fullscreen overlay; canShow always true |
| `'shell.overlay'` | `list` | `root` | 无 | 各插件的浮层项 | 全框架浮动层,click-through,子项自行恢复 pointer-events |

### 契约的其余三条

1. **`ctx.layout` 服务面**(IMobileLayout,对齐 0.1.5 ILayout):`toggleSidebar()` / `selectPanel()` / `beginNavigation()` / `openRightbar()` / `closeRightbar()`。`openDetails`/`closeDetails` 是右栏别名。返回关闭右栏时点击官方 `[data-sidebar-right-toggle]`（ExpandButton 只读自己的 store；这是已记录的缺失 seam）。
2. **ThemePresenter**:ui-theme 只持有快照,把快照写到 document(body 的 palette 属性、token 内联变量、theme-color meta)的职责随根布局走。本包 `theme-presenter.ts` 是上游同名文件的逐字拷贝;两个布局同时挂载会导致双写,所以 bundle 必须禁用上游 ui-layout 行。
3. **插件 inject**:`['slots', 'theme', 'sessions', 'remote.agentPresets', 'modelDirectories']`；静态 `dsh.client.inject` 同时声明提供这些服务的 Host 客户端模块。

## 与上游的行为差异(有意为之)

- 桌面三栏/拖拽把手/ concession 链 → 移动单栏 + 抽屉 + 弹层;store 状态从 px 宽度简化为 `{ drawerOpen, rightbarOpen, panelInfo }`。
- 会话切换时关闭右栏并关闭抽屉。手机隐藏「在本地打开」和右栏最大/最小化。composer dock 不注册 CompactStatsLine，官方 StatsPills 单行居中。窄屏 CSS 只重排官方 chrome，不另做功能实现。
- 抽屉打开时不传 `collapsed: true`,侧边栏的紧凑轨道 UI 在移动端永不出现。
- 上游暂未提供语义 seam、只能桥接本地化 ARIA 时，不得只匹配一种语言；当前上游中英文词典必须同时匹配，并由真实浏览器 fixture 固定两种 label 下的同一布局结果。
- 不得用控件已有的伪元素承载移动端文案；例如 View tab 的 `::after` 属于选中下划线，移动布局必须保留真实 tab 文本并通过间距分配解决宽度。
- 已知内置 preset 被用户层覆盖后可能携带非本地化 metadata；移动端只可按可证明的内置身份（`standard` / `ptc` / `minimal` / `cordis` 及其官方中英文全名）补齐紧凑文案。中文为「标准 / PTC / 极简 / 创造」，英文为「Standard / PTC / Minimal / Creator」；任意用户 preset 名称保持原样。
- 复用 Agent Presets 启用前遗留的空白会话时，移动端把 Host 默认 preset 写入该空白会话，使官方 Hero 模式选择器恢复显示；已有 preset 或已开始的会话不改动。
- 切换 Host 后若当前空白会话的默认模型 Provider 已不可路由，移动端优先把同名模型重映射到唯一有效 Provider，否则选择该 Host 目录中的首个有效模型；已开始的会话不自动改写。
- `conversation.input.left` 上游无 owner（渲染 `{}`），attach 经标准 `useSession` 选择器读 busy/subagent，不做 settings 侧读；Send 一律走程序化 Enter 交 Core 的 queue/steer 策略裁决（`inputActions.submit()` 只在 Core 未消费且不可 steer 时回退）。运行中 continuable 子会话的 Send+Stop 双钮只保留一个（`data-mobile-secondary-hidden` 隐藏，handler 不动），各 seat 只作用于自己所在的 `[data-composer-card]`。加号在 capture 阶段拦住 InputBar keepFocus，避免弹出 IME，再把 click 交给官方命令 listbox（含「文件」）。Host 命令面自带图标；仅 skill 源与没有 glyph 的插件命令行补统一立方体。Alpha.4 / 0.1.5 壳 seed 的 primitives 缺少 0.1.6 HOST_FACES 四枚图标；mobile-web 用 Vite transform 把这四枚 export 接到 **seeded** icons 模块上，不改 `.dsh-upstream`、不打 DSH core patch。缺失 seam：官方 pinned Alpha.4 primitives 没有这些名字，上游应把它们放进该 seed 或让 HOST_FACES 不再 `require` 较新导出名。
- 0.1.5 壳 seed 的 SlotCore 没有 alpha.2 `registerFactory`；Host conversation 会在加载期抛 `this._core.registerFactory is not a function`。`apps/mobile-web` 构建用 `DSH_SLOTS_SEED` **只**把 `@deepseek-ai/dsh-client-ui-slots` 接到 `dsh-v0.1.6-alpha.2-src`，其余 Vite alias 仍走 0.1.5 Host seed。缺该树则构建失败。缺失 seam：上游应把 `registerFactory` 放进 mobile 所钉的壳 seed，或让 Host renderer 不再包装壳里那份 SlotCore。`sidebar` 仍由官方 ui-sidebar 占用；本包只声明座位并让抽屉 flex 子项吃满高度，不复制 SidebarRoot。
- 0.1.5 壳 seed 的 primitives 没有 alpha.2 Host 实际 `require` 的运行时导出（`isDarwinDesktop`、`Checkbox`、`MarkdownDelegateProvider`、额外图标、`SHIELD_OUTLINE_PATH` / `SHIELD_OUTLINE_STROKE`）。缺 `isDarwinDesktop` 时 SidebarRoot 每次渲染抛错，slot error boundary 画出空白 crash face，手机抽屉是一块白；缺 `MarkdownDelegateProvider` 时有 transcript 的 ChatView 同样变白。`apps/mobile-web` 用 `DSH_PRIMITIVES_SEED` **只**把 `@deepseek-ai/dsh-client-ui-primitives` 接到 `dsh-v0.1.6-alpha.2-src`，其 npm 依赖仍从 0.1.5 Host seed 的 nested `node_modules` 解析（alpha.2 staging 没有 node_modules）。缺该树则构建失败。HOST_FACES / `isDarwinDesktop` 的 Vite transform 在 seed 已含这些导出时 no-op。缺失 seam：上游应把这些导出放进 mobile 所钉的壳 seed。窄屏 CSS 隐藏 `conversation.session.header.leading`（macOS 桌面开关栏，手机顶栏已有汉堡菜单），并把官方 New session / panel 行抬到 44px 触控高度。MICRO 2 系统 WebView 是 Chrome 101，会丢掉 `:has()`；设置重排改打 `data-settings-*`，抽屉底栏把连接横幅换到 Settings/Switch 下一行。

## 静态加载修订号

`apps/mobile-web/src/manifest.ts` 的 `MOBILE_LAYOUT_REV` 是 dshapp/APK 为本地 layout bundle 使用的缓存失效号；它不是 DSH 版本，也不是本包 `package.json` 的语义版本。每次发布静态 `client.js` 时递增，确保浏览器请求新 URL。

## 构建

`npm run build` 先由 `prepare-upstream.mjs` 选定根目录 `.dsh-upstream`；tsdown、类型路径、Host bridge 构建与本地打包必须全部消费这一个 checkout，禁止各自回退到 sibling 路径。随后执行 tsc(emit lib/types)+ tsdown(node 半 lib/index.js + 浏览器闭包工厂包 lib/client.js)。tsdown 预设在本仓库 `build/tsdown.client.ts`(上游 packages/client/tsdown.client.ts 的适配拷贝,PLATFORM_MODULES 指向上游 checkout)。浏览器包外部化 PLATFORM_MODULES + `@deepseek-ai/dsh-client-runtime/client`(运行时由 shell 的模块表应答),其余依赖内联并过 purity gate。

Vite 壳 bundle 有三处已记录的 seed 例外，都不改 `.dsh-upstream`：`DSH_SLOTS_SEED` 只把 `ui-slots` 接到 alpha.2 src；`DSH_PRIMITIVES_SEED` 只把 `ui-primitives` 接到 alpha.2 src（0.1.5 Host seed 的 nested `node_modules` + 壳上的 `diff` / `simple-icons`，因为 alpha.2 staging 没有 node_modules，且 0.1.5 不含这两包）；HOST_FACES / `isDarwinDesktop` 的 Vite transform 在该 primitives seed 已含导出时 no-op。其余 Vite alias 仍走 `DSH_UPSTREAM`（默认 0.1.5 src）。

## 同步策略

跟随 PLAN.md §4a:pin 上游版本;升级时 diff 上游 ui-layout 的 `src/client/index.ts`(四条声明)、`theme-presenter.ts`、`service.ts` 的 ILayout;加载期的 fail-loud 校验保证漂移立刻暴露。


## Release installation

The signed [dsh-mobile v1.1.14](https://github.com/NOirBRight/dsh-mobile/releases/tag/v1.1.14) APK carries this layout locally. It replaces the official root only in the mobile shell's narrow boot manifest; do not add it to a desktop-only WebUI profile, where that would replace the official desktop root.

For a custom mobile shell, the last published Host artifact is still the v1.1.6 tarball:

```sh
# Last published Host artifact
dsh plugin --profile web add --force https://github.com/NOirBRight/dsh-mobile/releases/download/v1.1.6/dsh-mobile-ui-layout-mobile.tgz
```

Verify with `dsh plugin --profile web list` and `dsh plugin --profile web doctor`; uninstall with `dsh plugin --profile web remove @dsh-mobile/ui-layout-mobile`. This private mobile-shell package targets DeepSeek Harness `0.1.2-alpha.4` through `0.1.5-rc.1` and intentionally has no sibling source, `link:`, `workspace:`, or absolute-path dependency. The current APK bundles the layout locally; the last separate Host tarball checksums are in the v1.1.6 Release. Roll back by restoring the prior mobile-shell bundle and rerunning its fixed command; restart only after the shell manifest validates.
