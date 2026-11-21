# 替换内置工作流并完善删除与节点选择

## Context

当前应用内置了多组旧图片、全能/首尾帧视频、局部重绘等工作流，节点图片/视频选择器还直接展开静态模型清单。用户要求以 `E:\gzl\工作流` 中的 9 份 JSON 和 `说明.txt` 为唯一内置来源，保持说明中的生图顺序；同时内置和自定义工作流都允许删除，删除后不得刷新复活，节点工作流选择改为单层菜单。

## 内置清单与默认项

不修改 `E:\gzl\工作流` 原文件，将其复制到项目的内置资产目录：

| 文件 | 分类与用途 | 默认策略 |
| --- | --- | --- |
| `QRw_D.json` | `t2i` + `i2i`，Qwen Image 全能，最多 9 图 | 两类均默认；节点图片模型只显示一次且排第 1 |
| `QRw_4×4.json` | `i2i`，单参考图 | 图片节点排第 2 |
| `moss_image.json` | `t2i` | 图片节点排第 3 |
| `z_image_turbo_api.json` | `t2i` | 图片节点排第 4 |
| `MS_V10.json` | `omniVideo`，MiniMax H3，9 图 + 3 视频 + 3 音频 | 视频默认 |
| `depth_video_api.json` | `depthVideo` | 深度视频默认 |
| `qwen3_5_text_api.json` | `text` | 文本默认 |
| `audio_minimax_music_3_api.json` | `audio` | 音频默认 |
| `H3_Face_Refine_Auto_Select_Api.json` | `faceRefine` | 人脸精修默认 |

旧内置项全部移除；`inpaint`、`frameVideo` 等分类仍可供用户导入自定义工作流，但不再提供旧内置默认项。

## 实施步骤

### 1. 替换内置资产与模型注册

- 用上述 9 份 JSON 替换 `web/src/assets/workflows/`、`web/public/workflows/` 和 `Comfy/Comfy-Api/workflows/` 中不再使用的旧内置文件；公共下载仅保留本次提供的 API JSON，不保留无新来源的旧可视化工作流。
- 重写 [comfyui-default-workflows.ts](file:///E:/infinite-canvas/web/src/services/api/comfyui-default-workflows.ts) 的导入、默认常量、Bundle 和 `getDefaultComfyWorkflowItems()`，删除旧 FP8/INT8、Flux、Inpaint、Frame 等出厂注册，按上表生成新 ID、名称、分类、顺序和默认标记。
- 更新 [image-models.ts](file:///E:/infinite-canvas/web/src/services/api/models/image-models.ts)、[video-minimax-h3-omni.ts](file:///E:/infinite-canvas/web/src/services/api/models/video-minimax-h3-omni.ts) 和 [models/index.ts](file:///E:/infinite-canvas/web/src/services/api/models/index.ts)：注册 QRw_D、QRw_4×4、Moss、Z-Image 与 MS_V10 的实际能力，复用现有 H3 12 档尺寸和参考资源约束，移除旧内置映射及静态回退。
- 同步 [use-config-store.ts](file:///E:/infinite-canvas/web/src/stores/use-config-store.ts) 的默认模型、supported IDs、默认渠道字段和默认选中值；不保留旧别名兼容代码。

### 2. 实现内置与自定义全局删除

- 在 `ModelChannel` 增加 `deletedBuiltinWorkflowIds`。调整 `mergeBuiltinWorkflows()`：以新默认清单为权威，清除旧 `isBuiltin` 项、保留自定义项，只合并未被删除的新内置项，避免升级后旧工作流残留或删除后重启复活。
- `getChannelWorkflows()` 尊重空数组；`getDefaultWorkflow()` 不再回退出厂清单；`findWorkflow()` 对显式但不存在的 `workflowId` 返回 `undefined`，继续遵循 Fail-loud，不静默执行其他工作流。
- 在配置 store 增加 `deleteWorkflowGlobally()`：自定义项按全局 ID 删除；内置项按当前内置清单的渠道语义 ID 删除各渠道对应项并记录实际删除 ID。删除默认项后重算该分类唯一默认项及 `WORKFLOW_CATEGORY_TO_CHANNEL_FIELD` 字段，无剩余项则清空。
- 在 [workflows/index.tsx](file:///E:/infinite-canvas/web/src/pages/workflows/index.tsx) 操作栏增加危险删除按钮和确认弹窗，明确删除会作用于所有渠道且不可直接撤销；删除后清理当前编辑选择。现有“恢复出厂”继续用于列表中仍存在的内置项，不额外增加恢复功能。
- 检查 `createModelChannel()` 和 `comfyui.ts` 各模态执行入口，禁止空列表或显式失效 ID 经静态 Profile、旧渠道字段或默认 JSON 回退执行；无可用工作流时明确提示并禁止生成。

### 3. 节点选择器改为真实列表与单层菜单

- 在 `services/api/models/index.ts` 增加纯函数，将传入的实际工作流列表映射为 Profile：内置通过工作流 ID 找注册 Profile，自定义复用 `buildCustomWorkflowProfile()`；按 Profile ID 去重，使 QRw_D 的 T2I/I2I 两项在图片节点只出现一次并保持指定顺序。
- 修改 `image-model-picker.tsx`、`video-model-picker.tsx`、`text-model-picker.tsx`、`audio-model-picker.tsx`：选项、当前 Profile 和选择解析均使用上述实际列表，不再展开 `BUILTIN_*` 或静态兜底；空分类显示“暂无工作流”。
- 修改 [channel-workflow-picker.tsx](file:///E:/infinite-canvas/web/src/components/channel-workflow-picker.tsx)：删除 category groups/options 嵌套，始终生成平铺选项；多分类时仅在选项行内显示分类文本以区分同名项。空列表时通过现有校准 effect 清空无效 `workflowId`。
- 同步 [canvas-node-prompt-panel.tsx](file:///E:/infinite-canvas/web/src/components/canvas/canvas-node-prompt-panel.tsx) 和必要的生成 helper：当前选择被删除时校准到同类默认/首项；无可用项则清空模型与工作流并禁用生成，不再引用已删除的静态 Profile。

### 4. 测试、文档与提交

- 更新受旧模型 ID、数量和默认项影响的现有测试，补充：新内置顺序与 QRw_D 去重、旧内置清理、内置/自定义跨渠道删除、默认项重算、最后一项删除、刷新不复活、恢复出厂、失效 ID Fail-loud、平铺 options 与空列表校准。
- 同步 `Comfy/Comfy-Api/README.md`、工作流指南及 `web/src/pages/guide/` 的实际下载清单；更新中英文 `pending-test.mdx`、检查 `todo.mdx`，并在 `CHANGELOG.md` 的 `Unreleased` 记录本次用户可感知变更。用户验收前不更新正式 features 说明。
- 完成后按项目约定创建详细 Git commit；`.trae/` 计划文件不提交，不修改 `E:\gzl\工作流`。

## 验证

1. 运行相关 Vitest 用例，不执行构建；重点覆盖配置 store、模型注册/选择器、ComfyUI 校验和生成 helper。
2. 首次加载及重开应用后，只出现新内置工作流，图片顺序为 QRw_D、QRw_4×4、Moss、Z-Image，QRw_D 不重复。
3. 分别删除内置与自定义工作流，确认所有渠道同步、默认项正确回退、刷新不复活；删除分类最后一项后节点显示空状态且不能提交生成。
4. 检查图片、视频、文本、音频和配置节点选择器均为单层菜单；显式引用已删除 ID 时给出明确错误，不执行其他工作流。
5. 验证 9 份工作流的 `_meta.title` 校验和动态 UI，尤其 MS_V10 的 Easy 节点多模态槽位及 QRw_D 的 9 图能力；检查指南下载文件均存在且旧内置入口已移除。
