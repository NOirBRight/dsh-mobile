# 3082 Provider / Composer E2E 验收

验收时间：2026-09-07。目标为现有 `http://127.0.0.1:3082`，未修改 Core 或 3080。真机为 PLB110，WebView 151.0.7922.199；使用同签名临时调试 APK，完成后恢复正式签名、不可调试的 1.1.7（versionCode 20）。

## 结果

| 检查 | 实际证据 |
| --- | --- |
| Provider 设置 | 7 张真实卡片；1280 / 390 / 320 × Light / Dark 六组均通过，展开/折叠无裁切；品牌、角色和 CommandCode SVG 检查通过。 |
| 运行时选择器 | Grok、Codex、OpenCode Go、DeepSeek 分组为鲸鱼；Antigravity 为自身图标。未改变模型选择。 |
| 额度面板 | 3 个 Provider（两排）高度 86px，2 个 Provider（一排）42px，详情 188px 且不受折叠上限限制；使用真实筛选控件，原命名空间设置经 revision 校验精确恢复。 |
| 会话 tab | 刷新后仅官方 Chat / Trajectory；真机显示对话 / 轨迹，没有 Antigravity Activity。 |
| 主会话 Queue | 真机触摸发送后写入 `next-turn`（seq 9077）；Stop 使第 6 轮以用户取消结束（seq 9167）。 |
| 主会话 Steer | 真机触摸发送后写入 `next-step`（seq 9217），第 7 轮内消费（seq 9295），返回 `STEER_TOUCH_ACCEPTED`，同轮完成（seq 9365）。Core busyEnter 原值已恢复。 |
| 子会话主按钮 | 空草稿运行态只显示 Stop；有草稿只显示 Send；发送后恢复 Stop。真实触摸触发子会话收件箱写入（seq 339 / 347）及用户取消（seq 374），未误投主会话输入。 |
| 子会话导航 | 真机触摸父会话子代计数打开目录；触摸条目进入真实可继续子会话；当前子会话标题切换器也能触摸打开目录。 |
| 原生历史回放 | 既有原生执行、绑定拒绝和恢复续跑日志仍可读取。DSH 父会话的实际工具名为 `subagent`、参数 `run_in_background:false`，Antigravity 前台 one-shot 子会话完成；不是 `delegate`，也不覆盖 AGY 后台可继续子会话。认证 `activity/read` 返回 29 条连续记录，绑定仍为 Antigravity；本轮不重复启动 Google 原生任务。 |

主 QA 会话：`session-b294023c-9a8c-451d-ab47-5d6b3cfac9a8`；可继续子会话：`9af066c6-9a46-4bf7-811b-27928dc3cc36`。最终主会话第 9 轮、子会话第 4 轮均完成；按 Core `removedCount` 规则重放收件箱，两者待发消息均为 0。

## 可执行检查与证据

- Provider：`check-lab-settings.mjs`；运行时：`/tmp/lab-picker-e2e.mjs`；额度：`/tmp/quota-live-safe.mjs`。
- 主按钮真机测试：`/tmp/phone-main-modes-e2e.mjs`、`/tmp/phone-child-buttons-e2e.mjs`；日志断言：`/tmp/verify-main-modes-e2e.mjs`、`/tmp/verify-child-e2e.mjs`。
- 真机目录：`/tmp/phone-touch-catalog-e2e.mjs`；截图：`/tmp/phone-count-touch-e2e.png`。
- 支持回归：`node --test apps/mobile-web/test/subagent-count-touch.test.mjs`，使用真实官方组件与现有移动触摸适配器。该受控回归不替代上述真机验收。
- 本机临时脚本依赖隔离的认证 CDP 浏览器和临时调试连接；验收结束后均已关闭，不应直接在正式手机上盲跑。原生回放检查为 model-switch 的 `scripts/check-lab-native-execution.mjs`。

## 恢复与产物

手机原 `3080 · AM01S` 连接已验证在线后保留，两条原有手机配对均保留；正式 APK 已重新安装并验证不可调试。临时 ADB 9231 转发已删除，无清数据、卸载或方向修改。旧 Micro 临时 QA 配对已由 3082 撤销。Micro 的 OEM WebView 101 不支持 `AbortSignal.any`，本轮未将其算作通过的真机环境。

首轮候选记录（非后续最新构建）：`apps/mobile-web/android/app/build/outputs/apk/release/app-release.apk`；SHA-256：`de996048c1338734b3b87773e76ef1048a17a0df2c86e1cbb1bcaebff756e8c2`。已通过 `npm run android:release`，未发布到 GitHub，未推广到 3080。

## 后续修正验收

以下覆盖用户追加的长模型名、三排额度、折叠额度和 Antigravity 安装流程；首轮的三/两个 Provider 测量不是三/两排测量。

| 检查 | 实际证据 |
| --- | --- |
| 模型名称 | 同一台 PLB110 的实际 APK：360/390 CSS px 下按钮 160px，完整显示 Gemini 3.8 Flash；320px 下真实命中 359px 媒体查询，按钮 144px，允许截断。三种宽度按钮互不重叠；设备指标覆盖已清除。 |
| 侧栏额度 | 真机 7 个 Provider，每格 40px，视口 134px，前三排六格全部完整可见；状态不换行，第七格通过滚动查看。受控浏览器回归保留旧换行样式会失败的对照。 |
| 折叠额度 | 等待所有读取完成后，七张真实卡片均在 aria-expanded=false 时显示额度；五张原惰性卡片复用已有读取入口，展开不重复请求。读取失败显示缺失标记，不伪造百分比。 |
| Grok | 真机侧栏与折叠卡片均显示当次真实查询解码的剩余 100%。有效当前周期的 proto3 零值省略得到支持；缺失周期、错误类型、付费池及已有旧预算的拒绝/回退检查通过。 |
| Antigravity | 真机已连接状态顺序为账户、额度、模型；账户按钮为退出登录、刷新状态。无 Advanced、路径输入或底部安装按钮。未安装与待登录分支通过渲染及后端真实文件探测回归验证，未为截图破坏实际安装或退出账号。 |
| 桌面复核 | 加强后的 check-lab-settings.mjs 要求七个折叠额度标记；1280/390/320 × Light/Dark 六组全部通过。原生历史与精确 subagent 工具断言在最终重启后通过。 |

证据：/tmp/phone-followup-composer-result.json、/tmp/phone-followup-sidebar-result.json、/tmp/phone-followup-settings-result.json；实屏 /tmp/phone-followup-composer.png、/tmp/phone-followup-sidebar.png、/tmp/phone-followup-antigravity-body.png。临时脚本依赖本机调试连接，不能当成无环境依赖的测试。

该轮真机验收候选为 `apps/mobile-web/android/app/build/outputs/apk/release/app-release.apk`，SHA-256 为 `8b385ed4e25bd859ae80437dc26427cedcac48071f8bf103c41e17102e47036a`，布局修订 0.1.52。正式签名、不可调试的 1.1.7/20 已安装，9231 转发已删除。此次开始时用户实际连接是 3082 · AM01S，结束前验证仍在线并保留；两条原有配对均保留，未切回首轮的 3080 基线。无清数据、卸载、方向设置修改、Core/3080 修改或公开发布。

## 发布前复核补充

独立 Standards / Spec 三轮审核的问题已关闭。最终插件产物刷新到原有 3082 后，七张卡片在 1280/390/320 × Light/Dark 的六组检查通过；`check-sdk-identity.mjs` 验证原生插件共享真实 Host 的请求标记和 `LlmError` 身份，`check-lab-native-execution.mjs` 的历史、绑定、续跑和精确 `subagent` 断言再次通过。未重复发起原生模型任务。

发布 APK 已重新签名构建，布局修订 0.1.53，版本仍为 1.1.7/20；SHA-256 为 `9e371ef594f329a43a570b8f1738f897bb142c6435a66e4e83f3bc75f63d8101`。`apksigner` 验证原签名证书，`aapt2` 验证不可调试。此次 ADB 未枚举手机，安装命令在变更设备前失败：新 APK 尚无真机安装证据，前述物理测量仅证明先前候选。原有已安装签名版本及配对未被本轮操作改动。
