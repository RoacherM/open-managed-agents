# Session Workspace P1 handoff

- 日期 / agent：2026-08-05 / claude
- 分支 / worktree：`feat/session-workspace` @ `/Users/byron/Desktop/Projects/Devs/hubs/oma-p1`（未 push）

## 目标

把已获用户逐项确认的交互原型（`hubs/session-workspace-prototype.html`）落成真实代码：
`/sessions/:id` 从单页对话变成自适应 workspace —— 单栏 / 分栏 / 全屏三态，
右侧 dock 挂四个面板（canvas / files / terminal / trajectory），
artifact 产出时事件驱动唤出。**不做 browser tab**（用户明确决策）。

## 已完成

8 个 commit，34 files changed，+4916 / −1897。

| commit | 内容 |
|---|---|
| `46a9d5d` | workspace shell 基础件：layout 状态机、tab registry、四个面板、dock、header |
| `4f0673f` | 后端：session outputs 改成递归树 + 文件内容读取 |
| `24e20b6` | 把 workspace 挂到 `/sessions/:id`，SessionDetail 拆成编排层 |
| `439a33f` | 修：分隔条拖拽完全失效 |
| `18195c1` | 修：单栏态阅读栏没有真正居中 |
| `dc13182` | 修：窄视口下 resource cluster 够不到 / tab 低于 44px / breadcrumb 撑破 header |
| `29de098` | MSW dev fixtures（`VITE_MSW=1`） |
| `6063a10` | 修：bottom sheet 三个触摸缺陷 |

关键产物：

- `apps/console/src/workspace/layout-state.ts` —— 纯状态机，无 React 依赖，可直接单测。
  常量对齐原型：默认 420 / 最小 320 / 吸附阈值 240 / 竖条 44 / 上限 65vw，
  localStorage key `oma-session-chat-width`。
- `apps/console/src/workspace/dock/registry.ts` —— 插件挂载点。
  `{ id, title, icon, badge?, displayModes, mount }`，带 JSDoc。
  `badge` 设计成 resolver 函数而非静态值，因为角标天然是动态的。
- `apps/console/src/workspace/useWorkspaceSignals.ts` —— 事件驱动唤出。
  线上事件 schema 里**没有** artifact write 事件，按 brief 要求在展示层兜底：
  工具结算标记（`agent.tool_result` / `agent.mcp_tool_result` /
  `agent.custom_tool_result` / `session.status_idle`，1200ms 去抖）触发重新拉
  outputs 列表并 diff 路径。首次列举只建基线，已存在的文件不会误报。
- `apps/console/src/pages/SessionDetail.tsx` —— 1631 → **236 行**，只剩编排。
- 后端最小改动：`packages/http-routes/src/sessions/index.ts` 下载路由放开路径分隔符
  并加穿越校验；`apps/main-node/src/lib/node-outputs-adapter.ts` 改递归遍历
  （R2 侧本来就带嵌套 key，只有 Node adapter 没走下去）。org 隔离沿用原有模式未动。
- icon rail 没有另造组件：现有 shadcn sidebar 的 `--sidebar-width-icon: 3.25rem`
  正好是原型要的 52px，只需在 session 路由下控制 `SidebarProvider` 的 open 状态，
  AppShell 改动约 15 行。

## 验证结果

静态门禁：`pnpm typecheck`（含 typecheck:node）通过；根 vitest 1646 passed / 0 failed；
console 67 passed；main-node 27 passed。
**仓库没有配任何 linter**（无 eslint / biome / oxlint 配置，也无 lint script），
所以"lint 通过"这条是空过的，静态门禁实际只有 typecheck。

浏览器实走（vite + MSW，非构建通过即算数）：

- 桌面 1440×900：单栏 760px 在工作区内居中 → 点 tab 滑入（420 + 2 + 966 = 1388）
  → Files 递归树点选预览 → 拖拽 420→568 并落 localStorage → 拖到阈值下吸附成 44px
  竖条（分隔条转 `--warning` 琥珀）→ 双击复位 → 全屏（chat 0 / dock 1388）→ Esc 恢复。
- 音频真播过，不是看截图判断：`audio.play()` 后
  `readyState:4, currentTime:0.53, paused:false, error:null`。
- 移动 375×812（devtools 真机视口）：汉堡抽屉（281px，全导航）→ 工作区**不自动弹出**，
  底部浮 chip「Files 有新内容 · 查看」→ 点 chip 开 sheet 并选中 Files →
  抓手拖拽跟手、短拉回弹 / 长拉消失、✕ 关闭、tab 横向可滚动（421 > 309）→
  Files 上下堆叠 + `<video controls>` 原生控件。

浏览器验证本身挖出 6 个真 bug（见上表四个 fix commit），全部已修并复验。
其中两个是同一类：`setPointerCapture` 对 UA 不认作 active 的 pointer id 会抛异常，
手势静默失效 —— 分隔条拖拽和 sheet 下拉消失都栽在这上面，统一改成 window 监听。

截图：`.agents/screenshots/`（`.agents/` 未纳入 git，仓库 gitignore 指定的内部文档目录是 `.docs/`）。

## 未完成 & 下一步

- **真实 SSE 流未验证**。唤出链路目前只在 MSW fixture 下跑通；结算事件类型名是对着
  schema 匹配的，没有对真实 agent run 观察过。接后端后要复核的是：这些事件类型是否
  真的在 artifact 落盘之后才到，以及 1200ms 去抖是否够。
- **全栈 E2E 未做**。`pnpm dev` 起 wrangler 需要 `@cloudflare/sandbox/Dockerfile`
  容器镜像，本地环境构不出来。后端改动靠单测覆盖。
- **Canvas host runtime / Terminal PTY 属 P2**，本轮按 scope 只做占位空态。
- **ChatBanner 偏离原型**：原型没给 Timeline 视图、thread 树、Stop 按钮、
  Linear/Slack context bar 的位置。没有静默砍掉，收进对话流上方一条 banner
  （`apps/console/src/pages/session-detail/ChatBanner.tsx`，JSDoc 里写了理由）。
  视觉上要不要改由 lead 裁决。

## 关键决策与约束

- **不做 browser tab**。agent 的浏览器能力以 headless 工具形态存在，不是 workspace 面板。
  `registry.test.ts` 里有一条断言锁死面板列表，就是防它爬回来。
- 视频 / 音频必须原生 `<video>` / `<audio>` controls —— 用户硬性要求，不许换自定义播放器。
- 不改后端事件 schema，唤出只在展示层兜底。
- 文本预览走裸 `<pre>` 而不是 CodeBlock：shiki 4.3.1 的 bundled language union 里
  没有 plaintext grammar，随便挑一个会把日志按源码上色。
- 样式只用现有 token，没有引入新颜色。

## 复测入口

```bash
cd /Users/byron/Desktop/Projects/Devs/hubs/oma-p1

# 静态门禁
pnpm typecheck
pnpm --filter managed-agents-console test -- --pool=forks   # 默认 pool 在本机起不来

# 浏览器复走（真实后端起不来时用这条）
VITE_MSW=1 pnpm -C apps/console dev
# 打开 http://localhost:5173/sessions/sess-msw-demo
# （handler 匹配任意 session id；fixture 在 apps/console/src/mocks/dev-handlers.ts，
#  SSE 流开启约 6s 后写入一个新 artifact，用来触发角标 / 唤出 / 移动端 chip）
```
