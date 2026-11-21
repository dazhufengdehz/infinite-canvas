# Trae 与本地 Canvas Agent 双向连接计划

## 概要

在现有“本地 Agent 与 WorkBuddy”连接区域增加明确的 Agent 提供方选择：`WorkBuddy`、`Codex`、`Trae`，并持久化选择。

本次同时交付两个方向：

1. **画布 → Trae**：选择 Trae 后，画布 Agent 面板通过本地 `traecli exec --json` 发送任务，支持当前图片附件、停止任务、错误提示和最终回复展示。
2. **Trae → 画布**：提供可复制的 Trae MCP JSON 配置，复用现有 `npx -y @zhuyichuan/canvas-agent mcp` 与全部画布工具，不另写 MCP 协议或工具实现。

首版不伪造 Codex 专属能力：Trae 不加载 Codex 模型、推理档位、Skill、历史线程或 Codex 审批；每次发送是一项独立 Trae CLI 任务，在同一个画布侧 `trae-session` 消息作用域内展示。

## 当前状态分析

- `web/src/stores/use-agent-store.ts` 的 `AgentProvider` 只有 `workbuddy | codex`，默认固定为 WorkBuddy，未持久化 Provider。
- `web/src/components/agent/agent-connect-view.tsx` 只有本地 Canvas Agent 地址、Token 与启动命令，没有 Provider 选择或 Trae MCP 配置入口。
- `web/src/components/agent/local-agent-panel.tsx` 的发送逻辑仅特判 WorkBuddy，其余全部请求 `/agent/codex/turn`；模型与 Skill 也使用“非 WorkBuddy 即 Codex”的条件，不能直接加入 Trae。
- `canvas-agent/src/server/http.ts` 已有 WorkBuddy、Codex 和 Canvas MCP 桥接路由，没有 Trae 路由。
- `canvas-agent/src/agent/codex-client.ts` 深度绑定 Codex app-server JSON-RPC、线程、审批与事件协议，不能改名复用；只参考其子进程生命周期、日志和中断模式。
- `canvas-agent/src/server/mcp.ts` 已把 MCP 工具调用转发到当前 Canvas Agent HTTP 服务，可直接用于 Trae IDE/CLI。
- 当前环境执行 `Get-Command traecli` 未找到命令，因此真实 Trae 对话验收需要用户安装并登录 Trae CLI 2.0；未安装状态必须明确报错，不得回退 Codex。
- Trae 官方文档确认：`traecli exec --json` 输出 JSONL，`--output-last-message` 可保存最终答复，支持 `--image`、`--cd`、`--sandbox`、`--ask-for-approval` 与 `--skip-git-repo-check`；Trae IDE 支持手动 stdio MCP 配置及项目级 `.trae/mcp.json`。

## 实施修改

### 1. 增加独立 Trae CLI 适配器

**新增 `canvas-agent/src/agent/trae.ts`**

实现以下导出，保持单文件、无额外抽象层：

- `checkTraeStatus()`：使用短超时子进程执行 `traecli --version`，返回 `{ available, version?, error? }`；Windows 使用可执行的 `traecli.cmd`，其他平台使用 `traecli`。找不到命令时返回中文安装/PATH 提示，不自动调用 Codex。
- `startTraeTurn(input, emit)`：校验任务并启动一次非交互进程，进程成功启动后立即返回，后台继续读取事件。
- `interruptTraeTurn(threadId?)`：仅在当前活动任务属于指定 Trae 线程时终止子进程；无活动任务返回 `false`。
- 同一时间只允许一个 Trae 任务，重复提交返回明确“Trae 正在运行”冲突错误。

执行参数固定为：

- `exec --json --ephemeral --skip-git-repo-check`
- `--cd <ensureSiteWorkspace 返回的工作目录>`
- `--sandbox workspace-write --ask-for-approval never`，首版不开放危险全权限，也不模拟交互审批。
- `--output-last-message <本轮临时文件>`，以该文件作为最终答复的权威来源，避免依赖官方尚未公布完整结构的 JSONL 事件字段。
- 有图片时增加 `--image <逗号分隔的临时图片路径>`；图片 Data URL 在本轮临时目录解码，结束后统一清理。
- 提示词通过 stdin 传入，参数末尾使用 `-`，避免 Windows 命令行转义和长提示词问题。

事件与生命周期：

- 使用固定 `threadId = "trae-session"`，每轮生成独立 `turnId` 与最终消息 `itemId`，所有事件同时携带 `sourceClientId`、`threadId`、`turnId`。
- 启动后发送 `agent_event: turn.started`；JSONL 按行解析，合法事件作为 `agent_log` 输出用于进度诊断，不把未知字段硬套成 Codex 消息。
- 进程成功结束后读取最终答复，非空时发送 `agent_event: item.completed`，`item.type = "agent_message"`；空答复按失败处理。
- 成功、非零退出、启动失败、用户停止均只执行一次收尾，发送对应 `turn.completed` / `agent_error` / `agent_done`，清理活动进程与临时目录。
- stderr 保留为日志；失败时把最后一段有效 stderr 或退出码作为用户可见错误，未登录等 CLI 错误原样透出。

### 2. 为 Trae CLI 工作目录准备画布 MCP

**修改 `canvas-agent/src/config.ts`**

- 在现有 Agent 工作目录初始化时补充 `.trae/mcp.json`，服务名为 `infinite-canvas`，内容仅包含 `command: "npx"` 与 `args: ["-y", "@zhuyichuan/canvas-agent", "mcp"]`。
- 仅在文件不存在时创建，不覆盖用户已有配置；沿用现有 `AGENTS.md` 初始化方式。
- 不新增 Trae CLI 路径配置项，首版统一从 PATH 查找。

这样从画布发起的 Trae CLI 任务也能发现当前画布 MCP；从 Trae IDE 项目内操作画布则使用连接页提供的同一份配置。

### 3. 增加 Trae HTTP API

**修改 `canvas-agent/src/server/http.ts`**

新增独立路由：

- `GET /agent/trae/status`：返回 CLI 可用性、版本，以及当前活动任务的 `busy/threadId/turnId`。
- `POST /agent/trae/turn`：校验 prompt、clientId、图片附件和单任务状态，调用 `startTraeTurn`；成功接受后返回 `{ ok, threadId }`，不等待整轮结束。
- `POST /agent/trae/interrupt`：调用 `interruptTraeTurn`，无可停止任务时返回 409。

保留现有 token、CORS、客户端在线校验和统一错误处理。启动终端提示由仅写 WorkBuddy 调整为 WorkBuddy / Trae / MCP。Trae 请求不得进入 `/agent/codex/*`，也不得修改 Codex 当前线程。

### 4. 前端 API 与 Provider 状态

**修改 `web/src/services/api/canvas-agent.ts`**

- 增加 `TraeStatusResponse` 类型。
- 增加 `fetchTraeStatus`、`runTraeTurn`、`interruptTraeTurn`，全部复用 `fetchAgentJson` / `jsonPost`。
- `runTraeTurn` 请求包含 prompt、clientId、图片附件及现有消息展示元数据；不传 Codex 的 model、effort、skill、conversation revision。

**修改 `web/src/stores/use-agent-store.ts`**

- `AgentProvider` 扩展为 `"workbuddy" | "codex" | "trae"`。
- 从 `localStorage` 的 `canvas-agent-provider` 读取并校验初始 Provider，默认仍为 WorkBuddy。
- 切换 Provider 时由面板写入该键；URL 与 Connect token 继续只表示 Canvas Agent 桥接服务，不混用 Trae 登录凭据。

### 5. 连接页增加 Trae 选项与 MCP 配置

**修改 `web/src/components/agent/agent-connect-view.tsx`**

- 在现有连接卡片前增加 `Segmented` Provider 选择：WorkBuddy / Codex / Trae；任务运行或正在切换时禁止切换。
- 保留当前 Local URL、Connect token 和本地服务启动卡片，三种 Provider 共用桥接服务。
- Trae 选中时展示独立卡片：
  - 调用 `/agent/trae/status` 显示“可用 / 未检测到 / 检测中”和版本或错误。
  - 未安装时提示“安装并登录 Trae CLI 2.0，确保 traecli 位于 PATH”，提供复制 `traecli login`。
  - 提供“复制 Trae MCP 配置”按钮，复制标准 `mcpServers.infinite-canvas` JSON。
  - 简短说明 IDE 可在“设置 → MCP → 手动添加”粘贴，项目级 CLI/IDE 可放入项目根目录 `.trae/mcp.json`。
- WorkBuddy 现有隐藏配置卡片不顺手恢复或重构。

### 6. 对话面板显式分流三种 Provider

**修改 `web/src/components/agent/local-agent-panel.tsx`**

- 顶部名称根据 Provider 显示 WorkBuddy / Codex / Trae，不再硬编码 WorkBuddy；Trae 最终消息标题也显示 Trae。
- Provider 切换时清理另一 Provider 的临时消息、活动 turn、审批和错误状态；Trae 使用 `trae-session` 并将本地对话状态置为可发送，Codex 继续走原有会话恢复。
- SSE `hello` 在 Trae 模式下不同步 Codex 工作区，也不调用 `/agent/codex/threads/reset`；改为读取 Trae 状态恢复 busy/turn。忽略 Trae 模式下到达的 Codex 状态、会话和工作区事件。
- 模型与 Skill 加载条件收紧为 `agentProvider === "codex"`；Trae 不请求 Codex models/skills，也不加载 Codex 历史线程。
- Trae 模式隐藏“历史”和“新对话”，不展示 Codex MCP 初始化提示；输入框只要求 Canvas Agent 已连接，CLI 是否可用由状态卡片和发送错误明确反馈。
- 发送改为三个显式分支：WorkBuddy → `runWorkbuddyTurn`，Codex → 原 `/agent/codex/turn`，Trae → `runTraeTurn`。Trae 分支携带实际图片附件，禁止落入 Codex。
- 停止同样按 Provider 分流：Trae 调 `interruptTraeTurn`，Codex 调原接口，WorkBuddy 不调用 Codex 中断。
- `turn.completed` 时统一清除对应 turn 的 `waiting/sending`，使 Trae 与 WorkBuddy 都能结束等待态。
- Trae 运行期间禁止切换 Provider、断开配置导致重复提交；收到终态后恢复输入。

### 7. 文案、变更记录与验收文档

**修改**

- `web/src/i18n/locales/zh-CN.ts`
- `web/src/i18n/locales/en-US.ts`

把连接标题和描述泛化为本地 Agent 与 WorkBuddy / Codex / Trae，补齐 Provider、CLI 状态、登录、MCP 配置、运行/停止和错误文案；界面默认保持中文。

- `CHANGELOG.md`：`Unreleased` 增加一条 `[新增]`，归纳 Trae CLI 对话与 Trae MCP 双向连接。
- `docs/content/docs/progress/pending-test.mdx` 与 `pending-test.zh-CN.mdx`：记录 Provider 持久化、Trae 对话、图片、中断、未安装错误和两种 MCP 使用方式的手动验收项。
- 检查 `docs/content/docs/progress/todo.mdx` 与对应中文文件；没有相关既有待办则不修改，不新增正式功能说明或新文档文件。
- 按项目规则创建详细中文 Git commit，仅提交本次相关文件，排除 `.trae/` 计划与用户现有改动。

## 假设与决策

- 首版 Trae 对话是独立执行任务，不提供 Trae 历史恢复、模型选择、Skill 管理或交互审批；这些能力不显示、不静默复用 Codex。
- JSONL 用于日志与诊断，最终答复以官方 `--output-last-message` 文件为准，避免猜测未公开的事件 schema，也避免流式消息与最终消息重复。
- 默认权限锁定为工作目录写入且非交互，不提供 `danger-full-access`。
- Trae IDE 与 Trae CLI 共用 stdio MCP JSON；无需新增 MCP server、HTTP MCP 服务或 Trae 专有工具协议。
- 本机当前未安装 `traecli`，实施时不伪造成功验收；真实对话测试列为用户安装登录后的手动验收。
- 遵循项目规则，不主动执行构建、语法检查或自动化测试。

## 验证步骤

1. 不安装/不登录 Trae CLI 时选择 Trae，连接 Canvas Agent 后应显示不可用原因；发送失败包含 Trae 提示，Codex 不被启动。
2. 安装并登录 Trae CLI 后刷新状态，显示版本；选择 Trae、连接服务并发送文本任务，面板最终只出现一条 Trae 回复，等待态正确结束。
3. 带一张图片发送，确认 Trae CLI 收到图片；发送中点击停止，确认进程终止、临时文件清理且可继续下一轮。
4. Trae 任务运行期间提交第二个任务或切换 Provider，应被明确阻止，不产生交叉消息。
5. 分别切换 WorkBuddy、Codex、Trae 并刷新页面，确认选择持久化，且只有 Codex 加载模型、Skill 和历史。
6. 在 Trae IDE 手动添加复制的 MCP 配置，调用 `canvas_open`、`canvas_get_state`，再创建一个文本节点，确认操作当前画布。
7. 将同一 JSON 写入测试项目的 `.trae/mcp.json`，通过 Trae CLI 读取并修改画布，确认复用同一 Canvas Agent token 和桥接服务。
8. 检查浅色/深色主题下 Provider 与 Trae 卡片可读，按钮完整可见；核对 CHANGELOG 与 pending-test 记录。

## Sources

- [TRAE CLI 2.0 命令行参数](https://docs.trae.cn/cli_command-line-parameters)
- [TRAE 添加 MCP Server](https://docs.trae.cn/ide_add-mcp-servers)
- [TRAE CLI 2.0 概述](https://docs.trae.cn/cli_about-trae-code-cli-2)
