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

## 3. upstream 同步（2026-08-06 已完成）

把 upstream（openma-ai）main 合入 fork main，分叉点 `c027a97`，共 9 个 commit：
6 个 dependabot 升级（react、vite 6→7、@vitejs/plugin-react 4→6、ai-sdk 组、
cloudflare 组、pnpm/action-setup）+ `4e48558` console i18n（中英文）+
`0b02377` main-node 接 model cards/environments、暴露 harness 错误 +
`461f188` main-node model cards 与 Cloudflare 对齐。

冲突与解法（6 个源码文件 + lockfile）：

| 文件 | 解法 |
|---|---|
| `packages/session-runtime/src/machine.ts` | 保 fork 的 `prepareTurn`。upstream 那笔改动只是把 `buildModel` 改成可 async，而 `prepareTurn` 本来就是 async，意图已满足 |
| `apps/main-node/src/registry.ts` | 保 fork 的 `createHarnessController`；upstream 新加的 `tenantId` 入参 fork 早已有，删掉合并产生的重复字段 |
| `apps/main-node/src/index.ts` | 保 fork 的 `createHarnessController`（已做 model card 解析 + Pi harness + environmentConfig），删掉 upstream 的 `buildModel/buildTools/buildHarness/buildHarnessContext` 及被其孤立的 `resolveNodeModelCreds`；`/environments`、`/model_cards`、`/models`、`/skills` 保 fork 的真实路由模块，不要 upstream 的 stub + `buildEnvironmentRoutes/buildModelCardRoutes`；`WebCryptoAesGcm` 保 fork 的无条件构造（`resolvePlatformRootSecret(): string` 已 fail-fast，upstream 的三元是死防御分支） |
| `apps/main-node/src/lib/node-session-router.ts` | 取 upstream 的 `appendSessionError()` 私有方法（与 fork 内联版同义，但复用已打开的 `log`）。fork 的 `next_page` 游标和 SSE 回放豁免 1024 上限未受影响 |
| `apps/console/src/main.tsx` | 两侧合并：保 fork 的 `startMocks()` bootstrap，把 upstream 的 `<I18nProvider>` 套在 `ErrorBoundary` 内、`QueryClientProvider` 外 |
| `apps/main/src/routes/model-cards.ts` | 取 upstream 的 `modelCardProbeUrl()` 共享 helper（`packages/http-routes`，带测试）。两边独立修了同一个 `/v1/v1` 重复 bug，upstream 版是单一真相源 |
| `pnpm-lock.yaml` | 不手解：先解完所有 package.json（本次无冲突，自动合并），再 `git checkout upstream/main -- pnpm-lock.yaml && pnpm install` |

**保守处理，需要留意的两处行为差异**：

1. fork 强制要求 model card——`validateModel` 和 `createHarnessController` 都在没有匹配
   card 时直接报错。upstream 这 9 个 commit 里带了 `ANTHROPIC_API_KEY` 兜底
   （tenant 无 card 时放行）。**没有采纳**，因为它与 fork 明确的
   "Configure it in Model Cards before running the agent" 错误文案相矛盾。
2. probe URL 对 oai-compatible 的 base_url 若不以 `/v1` 结尾，现在会补 `/v1`
   （upstream 行为），fork 原来原样透传。probe 是 best-effort、card 照常落库，
   影响面仅限"保存 model card 时的连通性提示"。

i18n 只在冲突涉及的部分移植（`main.tsx` 挂 provider）；**没有**给 P1 重构后的
`workspace/`、`session-detail/` 新代码补 `t()` 包装——超出本次同步范围，
如果要做是独立一件事。

同步脚本：`.agents/scripts/sync-upstream.sh`（fetch → 建 worktree 分支 → merge →
跑门禁 → 打印合入命令；有冲突则列文件 + 上述原则要点后 exit 1，不自动 push）。

门禁全绿：`pnpm typecheck` 通过；main-node 19 文件 / 50 passed（9 skipped，
无 PG 环境）；console 12 文件 / 87 passed（必须带 `--pool=forks`）；
根套件 485 文件 / 1651 passed / 0 failed。

## 复测入口

```bash
# 当前部署健康检查 + outputs 闭环复测（参考 2026-08-06 e2e）
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8787/
# 新 session → 让 agent 用 $OMA_OUTPUTS_DIR 和 /mnt/session/outputs 各写一个文件 → 查 outputs API
```
