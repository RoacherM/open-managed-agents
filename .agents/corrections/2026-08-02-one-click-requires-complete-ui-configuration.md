# 一键启动必须包含完整的页面配置路径
- 日期 / agent：2026-08-02 / codex
- 我原来的理解：优化重点是精简 Compose 和 `.env`，启动后由现有页面承担全部业务配置。
- 用户实际要的：不仅容器要一键启动，Environment 和 Provider 等关键配置也必须能通过正常 Form 完成；只能依赖 YAML 添加说明页面或数据契约仍不完整。
- 分歧根源：范围假设，把“页面支持配置”当成了已验证事实，没有先逐项走 Environment、Model Card、Agent 的真实表单路径。
- 以后如何避免：一键自托管验收必须实际走完 Environment 创建/编辑、Model Card Provider 创建、Agent 绑定与 Session 创建；YAML/JSON 只作为高级入口，不得承担基础配置缺口。
