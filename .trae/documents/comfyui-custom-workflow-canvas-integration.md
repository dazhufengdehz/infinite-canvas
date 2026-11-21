# 画布接入 ComfyUI 自定义工作流

## 目标概述

将参考项目已经具备的自定义 ComfyUI 工作流选择能力补入当前画布图片、视频、音频、文本四类业务节点，并打通从默认节点创建、模型切换、参数展示到请求执行的完整链路。

最终行为：

- 同一个单层 `Select` 中同时保留全部内置模型和当前主机已导入的自定义工作流，不隐藏内置模型，不自动改绑已有节点。
- 自定义项使用工作流图标和“自定义”标识；选中后节点的 `channelId`、`modelId`、`workflowId` 指向同一个工作流。
- 自定义工作流严格按 `_meta.title` 槽位生成参考资源配额和参数 UI；未标记的尺寸、时长、文本参数不显示、不注入。
- 内置模型继续走 `dispatchComfyuiModelWorkflow`，自定义工作流走通用 `applyBindings` / `applyVideoBindings` / `applyTextBindings`，不得回退成内置模型执行。
- 保留现有严格校验、Fail-loud、SelfLift、12 档视频尺寸、主机支持检查和媒体懒加载。

## 当前状态与问题

1. 四个模型选择器只遍历 `BUILTIN_*_WORKFLOW_MODELS`，自定义工作流没有入口；当前 `onChange(channelId, modelId, profile)` 可继续沿用。
2. `CanvasNodePromptPanel` 只用 `resolveModelIdFromWorkflowId` 反查内置工作流，图片还只查 `t2i`，无法正确回写自定义 ID。
3. `modelCapabilityOf` 不识别 `channel.workflows`，导致 `buildGenerationConfig` 将自定义 ID 回退为默认内置模型。
4. 图片、视频、音频请求会由回退后的内置 `modelProfile` 误入 `dispatchComfyuiModelWorkflow`；音频甚至始终使用内置 Profile。文本虽已使用通用绑定，但仍需阻止无效工作流 ID 静默回退。
5. 新建节点遇到默认自定义工作流时，`workflowId` 是自定义 ID，而 `modelId` 却回退为内置模型，展示与执行不一致。
6. 参数弹层通过 `getModelProfile(modelId) || 内置默认 Profile` 解析能力，自定义工作流会错误显示内置尺寸、时长等参数。
7. 参考项目的“自定义独占列表、自动改绑、宽松固定配额”不复制；`faceRefine` / `depthVideo` 继续走现有专用工具入口，不塞进普通视频模型列表。

## 实施修改

### 1. 增加统一的自定义工作流 Profile 适配器

新增 `web/src/services/api/models/custom-workflow.ts`，并由 `web/src/services/api/models/index.ts` 导出，供选择器、节点面板、节点工厂和请求层共用。

- `buildCustomWorkflowProfile(workflow)`：以 `workflow.id/name/category/description` 构造 `WorkflowModelProfile`，`slotMapping` 保持空对象；它只描述 UI 与校验能力，不注册为内置模型。
- 直接读取工作流节点的 `_meta.title`，不引入 `comfyui.ts` 运行时循环依赖。
- 按真实槽位计算 `references.maxImages/maxVideos/maxAudios`：统计 `ref_image_N`、`ref_video_N`、`ref_audio_N`，视频首尾帧计入图片容量；未出现的媒体类型上限为 0。
- 分类最小输入：`i2i/superResolve/angle/upscale` 至少 1 图，`inpaint` 固定原图 + 遮罩 2 图并启用 `maskSupported`；其余按槽位允许可选参考，不复制参考版固定 16 图宽松配额。
- 仅当同时存在 `width` 与 `height` 时提供尺寸配置：图片复用当前图片标准尺寸配置，视频复用当前 SelfLift 的 12 档硬件对齐尺寸配置；仅当存在 `duration` 时提供对应当前类型的时长配置。
- 自定义文本不伪造 `textConfig`，因此未标准化的 `maxLength/thinking` 控件默认隐藏。
- 提供按渠道和 ID 查找非内置工作流/Profile 的小函数，内置工作流仍由 `getModelProfile` 处理。

### 2. 四类选择器同时列出内置模型与自定义工作流

修改：

- `web/src/components/image-model-picker.tsx`
- `web/src/components/video-model-picker.tsx`
- `web/src/components/audio-model-picker.tsx`
- `web/src/components/text-model-picker.tsx`

具体行为：

- 每个主机先列现有内置模型，再追加该主机 `channel.workflows` 中的非内置工作流；选项值继续使用 `JSON.stringify([channelId, id])`。
- 图片自定义分类为 `t2i/i2i/inpaint/superResolve/angle/upscale`；视频仅为 `omniVideo/frameVideo`；音频为 `audio`；文本为 `text`。
- 当前选中值先解析内置 Profile，再解析当前主机的自定义 Profile，确保重新打开画布后名称、图标、分类和可用性都正确。
- 自定义项继续使用 `evaluateModelAvailability`，应用实际槽位配额、提示词长度和连线冲突检查；不自动切换旧节点，不在缺少某类自定义工作流时隐藏内置模型。

修改 `web/src/stores/use-config-store.ts`：

- `modelCapabilityOf` 增加自定义 workflow ID 到四类能力的映射，使 `resolveModelForCapability` 保留合法的自定义 ID。
- `isModelSupportedByHost` 仅对“已经显式保存在该主机 `workflows` 中的非内置工作流”认定主机支持；不使用全局 `ALWAYS_AVAILABLE`，其余资源规则照常执行，内置模型支持清单逻辑不变。

### 3. 修正节点回写、默认初始化与参数面板

修改 `web/src/components/canvas/canvas-node-prompt-panel.tsx`：

- 对所有模式解析当前精确 `nodeWorkflow` 和有效 Profile；自定义 Profile 用于当前可用性检查，不再回退到内置 Qwen、MiniMax 等 Profile。
- 四类 `onChange` 先按 `nextModelId === workflow.id` 精确查找自定义工作流，未命中再走现有内置 workflow 反查；同步写入 `channelId/modelId/workflowId`。
- 视频按实际 `workflow.category` 写入 `videoMode`，普通模型选择只接受 `omniVideo/frameVideo`，专用视频工具逻辑保持不变。
- 将解析后的 Profile 传给图片、视频、音频参数弹层；自定义视频禁止在参数弹层中切换成内置全能/首尾帧模型，模式由当前选中的工作流决定。
- 无 `prompt/caption/lyrics` 槽位的自定义图片工具允许在参考输入满足时提交空提示词；其他节点维持现有提交规则。

修改 `web/src/lib/canvas/canvas-node-factory.ts`：

- 默认工作流是自定义项时直接设置 `modelId = workflow.id`，同时保留同一 `workflowId`，不再回退为内置模型。
- 图片默认查找覆盖其支持的分类数组，视频覆盖 `omniVideo/frameVideo`；文本、音频沿用各自分类。
- 视频根据默认工作流分类设置 `videoMode`，尺寸归一化使用对应的自定义 Profile；没有默认工作流时保留现有内置默认模型。

修改 `web/src/lib/canvas/canvas-generation-helpers.ts`：

- 自定义 ID 经能力解析后原样进入请求配置。
- 视频模式优先由精确工作流分类决定，再考虑内置模型 ID 推断，避免随机自定义 ID 被误判为 `omni`。

### 4. 参数 UI 按自定义槽位显隐

修改：

- `web/src/components/canvas/canvas-image-settings-popover.tsx`
- `web/src/components/canvas/canvas-video-settings-popover.tsx`
- `web/src/components/canvas/canvas-audio-settings-popover.tsx`
- `web/src/components/image-settings-panel.tsx`
- `web/src/components/video-settings-panel.tsx`
- `web/src/components/audio-settings-panel.tsx`

统一增加可选 `profile` 入参并向下传递；未传时维持现有 `modelId` 解析行为。

- 图片：无 `width/height` 槽位时隐藏尺寸设置，仅保留生成数量等通用操作。
- 视频：无尺寸或 `duration` 槽位时分别隐藏对应设置和按钮摘要；自定义工作流隐藏模式切换，防止 `resolveVideoModelIdForMode` 改写为内置模型。
- 音频：无 `duration` 槽位时不显示无效的时长弹层；有时长槽位才显示当前时长配置。
- 文本现有 `CanvasTextSettingsPopover` 对未知自定义 ID 已无 Profile 并隐藏，不额外添加自定义文本参数。

### 5. 严格区分内置调度与自定义通用绑定

修改 `web/src/services/api/comfyui.ts`：

- 图片、文本、音频在指定 `workflowId` 时先无分类回退地精确查找；找不到立即报“所选工作流不存在，请重新选择”，不得静默采用默认工作流。视频保留现有显式报错。
- 每次执行自定义工作流前复用 `validateComfyuiWorkflow(json, category)` 校验槽位和输出。
- 将“用于校验的 Profile”和“用于内置 dispatch 的 Profile”分开：自定义 Profile 可执行 `validateModelExecution`，但只有内置 Profile 能进入 `dispatchComfyuiModelWorkflow`。
- 图片以目标工作流真实 `category` 执行，不再仅凭有无参考图强制归为 `t2i/i2i`；自定义 `inpaint` 将第一张参考图绑定到底图、第二张绑定到 `ref_mask`，其他图片分类使用通用参考槽位绑定。
- 视频自定义项使用 `applyVideoBindings`，保留首尾帧、多图/视频/音频、尺寸、时长和未使用槽位修剪；内置 SelfLift 调度不变。
- 文本自定义项继续使用 `applyTextBindings`，不伪造内置模型参数。
- 音频自定义项使用通用绑定而非内置 Music 03 dispatch；扩展现有 `ComfyuiBindings/applyBindings` 支持 `duration`、`caption`、`lyrics`，并复用 `parseAudioPrompt` 拆分提示词，未标记槽位不写入。
- 所有缺失必需输入、超量连线、非法尺寸/时长继续 Fail-loud，不新增静默忽略或宽松回退。

### 6. 回归覆盖、文档与提交

- 在现有 `web/src/services/api/__tests__/comfyui.test.ts` 增加自定义工作流用例：Profile 槽位配额、指定自定义 ID 不回退内置模型、通用绑定收到正确参数、无效 ID 显式报错、音频时长与文案槽位绑定。
- 在现有配置store测试覆盖自定义 workflow 能力识别和主机支持判断；不新建重复测试框架。
- 使用独立浏览器测试页面验收，不关闭用户现有标签页：四类下拉同时出现内置和自定义项；切换/刷新后绑定一致；自定义无尺寸/时长槽位时控件隐藏；内置 SelfLift 和 12 档尺寸保持不变；浅色/深色与生成按钮布局不回归。
- 若本机 `8188` 可用，再执行真实自定义工作流冒烟；不可用时以请求绑定测试和 UI 验收为准，不宣称真实生成通过。
- 更新 `CHANGELOG.md` 的 `Unreleased` 和 `docs/content/docs/progress/pending-test.mdx`，检查 `docs/content/docs/progress/todo.mdx` 是否需要同步。
- 按项目规范不执行构建；完成后用详细中文 message 创建 Git commit，不提交无关 `.trae/` 内容。

## 明确决策与边界

- 内置模型与自定义工作流共存，不采用参考版的自定义独占和自动改绑。
- `modelId` 对自定义项保存 workflow ID，用于兼容现有节点选择器契约；真正执行依据仍以精确的 `channelId + workflowId` 为准。
- 不迁移共享工作流同步、FIFO 调度、参考版旧媒体逻辑或宽松固定配额。
- 普通视频模型列表只加入 `omniVideo/frameVideo`；`faceRefine/depthVideo` 保持现有专用工具链路。
- 不改变本地持久化结构，不写旧数据迁移或兼容分支。

## 验收标准

1. 四类节点均可选择自定义工作流，且所有内置模型仍可见、可选、可执行。
2. 节点新建、切换、重新打开后，`channelId/modelId/workflowId` 与所选自定义工作流一致。
3. 自定义请求不会回退成内置模型，提交的工作流按真实槽位绑定，非法输入明确报错。
4. 未标记尺寸、时长和文本参数的自定义工作流不显示对应控件；有槽位时保留现有尺寸和时长交互。
5. 现有内置 SelfLift、12 档视频尺寸、资源校验、主题和节点紧凑布局无回归。
