# Browser 不是一等模块，自有 workspace 只有 Canvas 一个 surface

- 日期 / agent：2026-08-05 / claude
- 我原来的理解：console workspace 应包含 Browser tab（云端浏览器 live view + 接管 + origin 授权），作为独立里程碑 P3 与 Canvas 并列。
- 用户实际要的：**只要 Canvas**。后续多模态 agent plugins 全部基于 Canvas surface（结构化通道）构建；浏览器 live view 若未来需要（如强风控站点首次登录采集 cookie），做成 Canvas 插件，不做核心模块。
- 分歧根源：范围假设——把"agent 需要浏览器能力"错误升格为"workspace 需要浏览器界面"。当前生产链路（Dify workflow / OSS / API）没有任何需要 agent 操作第三方网页的场景。
- 以后如何避免：为 workspace 新增一等模块前，先问"它是插件生态的地基，还是只是一个能力的展示面？"——是后者就降级为插件或无头工具。`packages/browser-harness` 保留为无头 agent 工具，不做 UI、不做 StreamServer/screencast，除非用户明确提出。
