# ComfyUI 画布节点紧凑平铺化改造

## Context

用户希望参考 `E:\无限画布\infinite-canvas` 调整当前项目的 ComfyUI 节点、工作流和画布业务节点展示。对比确认：参考项目保留了当前已淘汰的 BF16/Turbo 工作流，且业务节点本体与当前项目基本一致；当前项目另有 INT8 SelfLift、12 档视频尺寸、媒体懒加载和渲染优化，不能整文件覆盖。

已确认方向：合并有用差异，保留当前新能力；只调整画布业务节点，不改 `workflow-graph`；节点卡片、模型与参数区、工具栏与提示词统一采用参考版的紧凑平铺风格。

## 实施范围

### 1. 模型选择器改为单层平铺展示

修改现有四个选择器：

- `web/src/components/image-model-picker.tsx`
- `web/src/components/video-model-picker.tsx`
- `web/src/components/audio-model-picker.tsx`
- `web/src/components/text-model-picker.tsx`

将当前“主机 → 模型”的二级 `Cascader` 改为单层 `Select` 选项列表：当前主机优先，选项直接展示模型图标、模型名称、所属主机和既有可用性警告。使用“主机 ID + 模型 ID”作为内部选项值，避免跨主机同模型 ID 冲突；选中后仍通过现有 `onChange(channelId, modelId, profile)` 回写。

保留并复用：

- `BUILTIN_*_WORKFLOW_MODELS` 与 `getModelProfile`，确保当前所有已适配的内置模型和工作流仍可选择。
- `getDefaultWorkflow`、`resolveModelIdFromWorkflowId` 与现有工作流绑定逻辑。
- `evaluateModelAvailability`、资源冲突禁用和前置输入警告。
- SelfLift 默认模型、全能/首尾帧模式切换及当前 12 档视频尺寸契约。

不迁移参考项目的宽松自定义工作流 Profile、自动改绑自定义工作流或绕过模型校验的逻辑。

### 2. 压缩提示词面板与操作区

修改 `web/src/components/canvas/canvas-node-prompt-panel.tsx`：

- 缩小面板、输入区、操作按钮的内边距与间距，降低输入区默认高度，减少厚重圆角和阴影，改为轻量边框的扁平面板。
- 模型选择器、参数按钮、`@`、提示词库等操作收敛到紧凑的一行；空间不足时保留横向滚动或合理换行。
- 快捷指令由胶囊样式改为轻量文本按钮，颜色从画布主题获取，不新增硬编码 `stone` 主题分支。
- 保持正文独立滚动，模型、参数和生成/停止按钮固定可见；不改变提交、再次生成、停止、引用资源和展开编辑行为。

### 3. 统一节点卡片和参数弹层的紧凑扁平风格

修改：

- `web/src/components/canvas/canvas-node.tsx`
- `web/src/components/canvas/canvas-image-settings-popover.tsx`
- `web/src/components/canvas/canvas-video-settings-popover.tsx`
- `web/src/components/canvas/canvas-audio-settings-popover.tsx`
- `web/src/components/canvas/canvas-text-settings-popover.tsx`

调整内容：

- 节点外框、空内容区和状态区减少装饰性圆角、边框重量与阴影；选中、连线、错误状态仍保持清晰，不改变媒体内容比例和节点尺寸计算。
- 参数弹层使用更紧凑的行高、间距和扁平选项按钮，保留现有动态槽位显隐，未由工作流标记的参数继续不显示。
- 保留媒体懒加载、离屏卸载、`areCanvasNodePropsEqual`、连接端口、缩放反向补偿和拖拽行为，只改视觉呈现。
- 全部颜色继续来自 `canvasThemes`、`useThemeStore` 或既有主题写法。

### 4. ComfyUI 工作流与适配边界

保留当前 `web/src/services/api/comfyui-default-workflows.ts`、模型 DSL 和工作流资产，不用参考文件覆盖。核对后无可直接迁移且符合当前架构的新工作流展示能力，本次不为了制造差异而修改执行层。

明确不迁移：

- BF16/Turbo 及回退旧 FP8 默认路由。
- 固定 `class_type` 的 MiniMax H3 Easy 识别。
- 宽松自定义工作流 Profile 和服务端共享工作流。
- 旧版直接音视频加载、旧弹层事件监听。
- 参考项目的 FIFO 队列能力；它属于独立任务调度需求，不夹带在本次 UI 改造中。
- `web/src/components/workflow-graph/`。

## 验证

使用真实前端和 Sidecar 打开独立测试页面，挂载真实画布节点面板，检查：

1. 图片、视频、音频、文本节点的模型列表均为单层平铺，当前所有内置模型可见，跨主机选择能正确回写 `channelId`、`modelId`、`workflowId`。
2. SelfLift 默认值、全能/首尾帧切换、模型资源警告和禁用原因不回归。
3. 节点卡片在默认、悬停、选中、加载、错误状态下清晰可用，浅色与深色主题一致。
4. 工具栏在上、提示词在下；受限高度下正文可滚动，生成按钮完整可见且可点击。
5. 图片比例、视频 12 档尺寸、未标记槽位隐藏、媒体懒加载、节点缩放和连线行为不回归。
6. ComfyUI 执行层与 `workflow-graph` 无无意差异。

按项目规范更新 `CHANGELOG.md` 与 `docs/content/docs/progress/pending-test.mdx`；检查 `todo.mdx`，无新增待办则不制造差异。完成后提交一次包含详细说明的 Git commit，不执行构建。
