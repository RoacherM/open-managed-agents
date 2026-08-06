# 下一步路线（用户 2026-08-06 定）

- 日期 / agent：2026-08-06 / claude
- 背景：sandbox 路径契约已修（main `9615278`，e2e 四点闭环）；workspace P1 已上线。

## 1. 优化 workspace 设计（优先）

- **用户怀疑 skills 读取仍有问题**。已知线索：
  - skills 经 pi VFS 的 jail 物化在 `<workdir>/home/user/.skills/`（guest 路径直连 executor）；
  - 宿主侧 skills blob 在 `/app/data/files-blobs/t/<tenant>/skills`（sess-lfm5 trace seq 11 可见）；
  - e2e 修复前 Pi harness 起 turn 时读 `.skills/film-production/references/core/roles/director-agent.md`
    —— skills 的 references 是运行时懒加载读文件，任何路径契约变化都会波及。
  - 排查入口：新起 session 看 turn 起始的 skills 读取是否成功；对照
    `apps/main-node/src/lib/pi-harness-driver.ts`（skills 传入 HarnessAgent 处，:350）。
- console 侧三个已确认未修缺陷（2026-08-06 review，按收益排序）：
  1. 事件去重丢事件：key 改 `id ?? session_thread_id:seq ?? content`，补 `text` 字段
     （thinking 每 session 只显示 1 条；Timeline 时长错）；
  2. node 运行时不发 `session.status_running/idle`：Stop 按钮永不出现、打字指示不显示、
     settle 刷新缺触发器；顺手给所有事件盖 id 可从源头消灭 1；
  3. pi `finish-step` 契约违例 → harness_turn_failed（vendor `@ai-sdk/harness@1.0.48`，需单独排查）。

## 2. Terminal + Sandbox 支持（其次）

- workspace 的 Terminal 面板目前是 P1 占位空态（`dock/panels/`）；
- 需要：真实 PTY 通道接 sandbox（subprocess adapter 先行），前端 xterm 类组件；
- 关联既有讨论：bash 写入边界（L2 writableRoots）可与 terminal 一起考虑权限模型。

## 复测入口

```bash
# 当前部署健康检查 + outputs 闭环复测（参考 2026-08-06 e2e）
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8787/
# 新 session → 让 agent 用 $OMA_OUTPUTS_DIR 和 /mnt/session/outputs 各写一个文件 → 查 outputs API
```
