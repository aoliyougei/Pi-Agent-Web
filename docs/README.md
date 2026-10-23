# 项目文档索引

按任务选择相关文档，无需每次阅读全部内容。本索引随功能和文档变化维护；项目工作流程见根目录 [AGENTS.md](../AGENTS.md)。

## 功能与接口说明

| 主题 | 文档 |
| --- | --- |
| RPC 后端连接与配置 | [Pi Agent connections](pi-agent-connections.md) |
| cwd 与项目会话发现 | [Project session discovery](project-session-discovery-web.md) |
| Worktree 使用 | [中文](worktrees.zh-CN.md) / [English](worktrees.md) |
| 工具选择与 Chat only | [ADR 0002](adr/0002-chat-only-tool-selection.md) |
| 内置子代理开关 | [ADR 0003](adr/0003-built-in-subagent-toggle.md) |
| 国际化 | [i18n](i18n.md) |

这些文档用于理解对应功能；其中的版本示例、部署命令和实现说明仍需与当前代码及运行环境核对。

## 版本验收与历史证据

以下记录仅适用于文中候选、版本和场景，不代表后续版本自动兼容，也不替代新的联合验收。

| 适用范围 | 记录 |
| --- | --- |
| Pi 1.4.0 适配与联合验收 | [验收说明](pi-140-compatibility.md)、[原始证据](verification/pi140/) |
| RPC 0.2.0 / Pi 1.2.0 兼容验证 | [兼容记录](rpc-020-compatibility.md) |
| RPC 代理迁移阶段 | [阶段记录](agent-proxy-progress.md)（部分状态描述已属历史） |
| CLI 会话锁调查 | [调查记录](session-lock-cli-findings.md) |
| 项目发布记录 | [releases/](releases/) |
| 设计与实施计划 | [superpowers/](superpowers/)（不视为功能已实现的证明） |

新增版本时补充对应证据并更新索引；不要覆盖旧版本结论，或将旧候选的通过结果移用于新 digest。

## 发布流程说明

本 fork 的 Git/Docker 发布规范见 [AGENTS.md](../AGENTS.md#4-提交与发布)。[release.md](release.md) 是上游 npm 发布流程，仅作参考，不直接执行其中的发布命令。

## 索引维护

- 功能变更时同步更新说明及入口；移除功能时删除其当前说明入口，必要时保留历史记录。
- 专题内容转移或合并后，更新链接，避免多个文档同时充当同一规范的权威来源。
- 发现内容过时时先核实实现，再更新、归档或标注范围；不因文件名较新就认定其代表当前状态。
