# @dsh-mobile/ui-layout-mobile

移动端根布局:`dsh.client` 插件(platform web),注册进 web shell 内建的 `'root'` slot,**逐字实现上游 `@deepseek-ai/dsh-client-ui-layout` 的 slot 契约**,使全部 leaf 插件(ui-sidebar、ui-conversation 等)不经修改继续工作。布局本体是移动形态:单栏 + 顶栏(菜单按钮)+ sidebar 滑出抽屉 + details 全屏底部弹层 + 安全区内边距。

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
3. **插件 inject**:`['slots', 'theme']`(`dsh.client.inject` 清单为 informational,与此保持一致)。

## 与上游的行为差异(有意为之)

- 桌面三栏/拖拽把手/ concession 链 → 移动单栏 + 抽屉 + 弹层;store 状态从 px 宽度简化为 `{ drawerOpen, detailsOpen }`。
- 会话切换时除关闭 details(上游行为)外**还关闭抽屉**(移动端导航即收起的惯例)。
- 抽屉打开时不传 `collapsed: true`,侧边栏的紧凑轨道 UI 在移动端永不出现。

## 构建

`npm run build` = tsc(emit lib/types)+ tsdown(node 半 lib/index.js + 浏览器闭包工厂包 lib/client.js)。tsdown 预设在本仓库 `build/tsdown.client.ts`(上游 packages/client/tsdown.client.ts 的适配拷贝,PLATFORM_MODULES 指向上游 checkout)。浏览器包外部化 PLATFORM_MODULES + `@deepseek-ai/dsh-client-runtime/client`(运行时由 shell 的模块表应答),其余依赖内联并过 purity gate。

## 同步策略

跟随 PLAN.md §4a:pin 上游版本;升级时 diff 上游 ui-layout 的 `src/client/index.ts`(四条声明)、`theme-presenter.ts`、`service.ts` 的 ILayout;加载期的 fail-loud 校验保证漂移立刻暴露。
