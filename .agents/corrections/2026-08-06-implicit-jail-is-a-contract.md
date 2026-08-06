# 删"隐式魔法"前没确认它是否是 vendor 依赖的契约

- 日期 / agent：2026-08-06 / claude
- 我原来的理解：`LocalSubprocessSandbox.resolvePath` 把 workdir 外绝对路径静默改写到
  workdir 下是"隐式 jail 魔法"，按最小实现原则应删除、改为显式报错（08fb552）。
- 实际情况：`@ai-sdk/harness-pi` 给 Node fs 打全局补丁，pi VFS 拿 guest 绝对路径
  （`/home/user/.skills/...`）直接调 executor 的 readFileBytes/writeFileBytes，
  **读写对称地依赖这个改写作为 jail**——skills 就物化在 `<workdir>/home/user/.skills/`。
  改成报错后 Pi harness 起 turn 即挂（e2e session sess-00324uq17k8irxt4 抓到，未流到用户）。
- 分歧根源：环境假设——把"没有显式文档的行为"等同于"没有消费者的死代码"。
  真正的死代码（root symlink 机制，从未激活且并发即坏）和被依赖的隐式契约
  （workdir jail）混在同一次清理里。
- 以后如何避免：删除任何"隐式行为"前，先 grep 全部调用方**包括 vendor 包的调用栈**
  （本例线索早就在 trace 里：`pi-workspace-vfs.ts:277 → LocalSubprocessSandbox.readFileBytes`
  直连，不经 toExecutorPath）。修正后的处理是把隐式行为**升格为显式文档化契约**
  （9615278），而不是删除或替换。
