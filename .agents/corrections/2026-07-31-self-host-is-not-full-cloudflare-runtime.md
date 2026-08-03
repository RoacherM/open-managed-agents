# Docker 自托管版不是完整 Cloudflare 运行时
- 日期 / agent：2026-07-31 / codex
- 我原来的理解：用户要先把项目跑起来，因此选择 `docker compose` 自托管 Node 版，并把启动成功近似描述为项目可完整使用。
- 用户实际要的：运行并体验仓库展示的完整控制台与平台能力，而不是只有 Agents、Sessions 等核心接口的自托管功能子集。
- 分歧根源：范围假设，未在启动前明确区分 Self-host、CF local 和 CF prod 三种拓扑的功能矩阵。
- 以后如何避免：部署前必须先对照 `docs/deployment.md` 和 `docs/self-host.md` 的功能矩阵，明确告知所选拓扑的缺失项，再执行启动。
