# 从小说到 MiniMax H3 出片路线优化计划

## 1. 目标与结论

当前问题不只是某个 ComfyUI 节点，而是上游把 Markdown 同时当作创作文本、程序数据和用户编辑状态，下游再用标题与正则恢复资产、镜头和引用，导致改名、重名、跨集共享、局部重生成、媒体上传及节点连线都容易失同步。

本次采用限定范围的结构化方案：

- **不引入 OpenH3-IR**，不增加 Python 编译器、Node.js 服务、额外 HTTP 服务或新的中间代理。
- 小说原文、提炼素材、故事设定、分集大纲、分集剧本继续使用 Markdown。
- **全剧资产与分集分镜改为唯一权威的结构化数据**；画布上的“资产/分镜”文本节点只展示由结构派生的只读摘要，不再形成第二份可编辑权威。
- 每个镜头完整支持 **最多 9 张参考图 + 3 个参考视频 + 3 个参考音频**，引用数组顺序唯一决定 `<Picture N>`、`<Video N>`、`<Audio N>` 及 ComfyUI FIFO 槽位顺序。
- 镜头节点固定使用现有 **MiniMax H3 MS_V10** 工作流，复用现有媒体收集、上传、绑定、空槽修剪、提交和结果写回，不重写执行引擎。
- 本迭代不做整集拼接、自动剪辑、通用 IR/DSL、旧剧本数据迁移或无关画布重构。

目标路线：

**小说/长文 → 故事设定 → 分集大纲 → 分集剧本 → 全剧五类资产 → 准备图片/视频/音频媒体 → 分集 H3 分镜 → 自动节点与有序连线 → 单镜头/批量 MiniMax H3 出片。**

## 2. 当前断点

1. [script-model.ts](file:///d:/infinite-canvas/web/src/lib/canvas/script-model.ts) 以资产名称、集名和镜头标题生成 key，并通过正则解析/替换 Markdown；重名、改名和局部重生成不可靠。
2. [canvas-script-adapt-dialog.tsx](file:///d:/infinite-canvas/web/src/components/canvas/canvas-script-adapt-dialog.tsx) 与 [use-script-store.ts](file:///d:/infinite-canvas/web/src/stores/canvas/use-script-store.ts) 仍把资产和分镜当字符串保存，和新版五类资产、多行 H3 解析不一致。
3. [script-generation.ts](file:///d:/infinite-canvas/web/src/lib/canvas/script-generation.ts) 在缺失本集正文时使用 `scriptEpisodes[index] || script`，会把整部剧本错发给某一集；单集流程还可能落入旧的普通分镜提示词分支。
4. [canvas-storyboard-view.tsx](file:///d:/infinite-canvas/web/src/components/canvas/canvas-storyboard-view.tsx) 只完整展示角色/场景/道具，上传固定为图片，单镜头重生成仍按旧“镜N”标题正则处理。
5. [project.tsx](file:///d:/infinite-canvas/web/src/pages/canvas/project.tsx) 同步时未把尺寸纳入失效判断，每次删除并重建镜头全部输入连线，且不清理已从计划中消失的剧本节点。
6. 镜头节点当前继承任意默认视频工作流，不能保证一定走 MiniMax H3；剧本引用顺序也没有与实际生成上下文做最终一致性校验。

## 3. 唯一数据契约

### 3.1 修改 [canvas.ts](file:///d:/infinite-canvas/web/src/types/canvas.ts)

将 `CanvasScriptState` 升级为 `version: 2`，保留 `source/condensed/setting/outline/script/options`，把 `assets` 和 `storyboard` 改为以下结构。类型放在现有全局类型入口，不再同时维护 Markdown 副本。

```ts
type ScriptAssetKind = "character" | "scene" | "prop" | "video" | "audio";

type ScriptAsset = {
    id: string;                 // 全剧资产提取阶段由系统分配并持久化，重名/改名不改变
    kind: ScriptAssetKind;
    name: string;
    description: string;        // 外貌、用途、保留特征等多行说明
    prompt: string;             // 对应图片/视频/音频节点的生成提示词
};

type ScriptH3Prompt = {
    subject_definitions: string;
    summary: string;
    retention_analysis: string;
    detailed_description: string;
    overall_soundscape: string;
    non_diegetic_music: string;
};

type ScriptShot = {
    id: string;                 // 客户端生成并持久化
    number: number;             // 集内顺序，从 1 开始
    title: string;
    duration: number;           // 整数，1～15 秒
    size: string;               // MINIMAX_H3_SIZES 中的精确值，如 768x1344
    imageAssetIds: string[];    // 仅 character/scene/prop，最多 9
    videoAssetIds: string[];    // 仅 video，最多 3
    audioAssetIds: string[];    // 仅 audio，最多 3
    h3: ScriptH3Prompt;
};

type ScriptStoryboardEpisode = {
    id: string;                 // episode_1、episode_2……按集序号稳定生成
    number: number;
    title: string;
    shots: ScriptShot[];
};

type CanvasScriptState = {
    version: 2;
    updatedAt: string;
    source: string;
    condensed: string;
    options: CanvasScriptOptions;
    setting: string;
    outline: string;
    script: string;
    assets: ScriptAsset[];
    storyboard: ScriptStoryboardEpisode[];
};
```

补充约束：

- 资产 ID 必须在全剧资产提取阶段由系统使用现有 `nanoid` 统一分配，并在提取结果首次入库前写入；不得等到分镜、画布节点或视频生成时补发。模型只负责提取内容，后续阶段不得重新分配或按名称推导资产 ID。
- 镜头 ID 在分镜生成阶段由客户端生成并持久化；集以序号标识，集名只用于显示，本迭代不提供拖拽调整集顺序。
- 后续分镜与视频参考只能直接引用资产 ID，按三类有序 ID 数组解析到资产节点，再由节点 `storageKey` 读取实际媒体；禁止按名称猜测或匹配。缺失 ID、重复 ID、未知引用必须显式报错并停止生成。
- 图片、视频、音频的实际媒体内容、生成状态和结果仍只存在画布节点 `metadata`，剧本状态不保存 base64、媒体 URL 或冗余 `ready` 布尔值。
- `character/scene/prop → Image`，`video → Video`，`audio → Audio`；资产是否就绪由对应节点的类型和 `metadata.content` 派生。
- `formatH3Prompt(shot.h3)` 按固定六段顺序生成提交文本；显示用资产/分镜 Markdown 摘要也由结构即时派生，不能反向编辑或参与生成。

### 3.2 修改 [use-script-store.ts](file:///d:/infinite-canvas/web/src/stores/canvas/use-script-store.ts)

- 新建、加载、更新统一使用版本 2；修正 `emptyScriptState(options)` 与 `createEmptyScriptState` 参数不一致。
- 按项目约束不做版本 1 自动迁移；遇到非版本 2 数据时保留原文件并显示明确的不兼容提示，不能静默清空或覆盖。
- 保留现有 400ms 防抖与 `flush`，结构化字段通过同一个项目存储入口持久化。

## 4. Agent 协议与原子生成

### 4.1 修改 [script.ts](file:///d:/infinite-canvas/canvas-agent/src/agent/script.ts)

继续复用现有 Canvas Agent `/agent/script/generate` 和 Chat Completions 配置，不新增模型供应商或服务。

- `setting/outline/script` 保持现有 Markdown 输出。
- `assets` 的模型原始响应只输出一个 JSON 对象：`{ "assets": [{ "kind", "name", "description", "prompt" }] }`；仍保持全剧一次提取，跨集合并同一资产。解析完成后、首次入库前，系统必须为每项分配全剧唯一 ID，使正式提取结果变为 `{ "assets": [{ "id", "kind", "name", "description", "prompt" }] }`；未完成发号不得保存或进入分镜阶段。
- `storyboard` 只支持明确的单集或单镜头 H3 JSON 输出，删除可回退到普通图片分镜的旧提示词分支。
- 单集返回 `{ "episode": { "title", "shots": [...] } }`；单镜头返回 `{ "shot": {...} }`。镜头字段对应上述结构中的 `number/title/duration/size/imageAssetIds/videoAssetIds/audioAssetIds/h3`，不包含内部 `id`。
- 分镜请求中的 `assets` 仍沿用现有字符串传输字段，但内容改为完整资产 JSON（含客户端 ID）。模型只能引用这些已有 ID，不能按名称猜测 ID。
- 为单镜头重生成在 `ScriptGenerateInput` 增加可选 `shot` 字符串，内容为当前镜头 JSON；同时传入本集大纲、本集正文、全剧资产和用户反馈，返回一个替换镜头，不重写整集。
- 提示词明确：六段 H3 正文使用英文；引用顺序即编号顺序；`<Picture N>/<Video N>/<Audio N>` 从 1 连续编号；时长 1～15 秒；尺寸只能使用当前方向对应的 H3 预设。
- `size` 的可选值直接来自前端请求中提供的当前方向预设，不在 Agent 内另写一套尺寸表。

### 4.2 修改 [canvas-agent.ts](file:///d:/infinite-canvas/web/src/services/api/canvas-agent.ts)

- 与 Agent 输入同步增加可选 `shot` 字段；响应仍沿用现有 `{ content: string }`，避免扩大接口改造。
- 结构化解析和校验放在前端剧本模型层，接口层不把错误内容静默转换成空数组。

### 4.3 修改 [script-model.ts](file:///d:/infinite-canvas/web/src/lib/canvas/script-model.ts)

将 Markdown 资产/分镜解析替换为严格 JSON 解析、结构校验、派生视图和格式化函数：

- `parseGeneratedAssets`：完整解析后在同一资产提取事务内由系统分配并持久化全剧唯一资产 ID；要求类型合法、名称与提示词非空、条目完整、ID 无重复。只有带完整 ID 的正式资产结果才能保存并供后续分镜/视频直接引用。
- `parseGeneratedEpisode` / `parseGeneratedShot`：完整校验后由客户端分配镜头 ID；单镜头替换时沿用原镜头 ID，整集替换时保留集 ID并替换该集镜头。
- `buildScriptProjectView`：按大纲序号关联剧本正文和结构化分镜，派生资产、集、镜头视图及稳定 `scriptKey`；集名不再用于关联。
- `replaceEpisodeBlock`：按集序号替换 Markdown 正文，不再按可改标题正则定位。
- `validateH3Shot`：校验六段均非空、时长为 1～15 的整数、尺寸属于 `MINIMAX_H3_SIZES` 且方向正确、总提示词不超过 H3 profile 限制。
- 校验三类引用数量、重复项、资产存在性和类型；允许同名资产，但不允许重复 ID 或未知 ID。
- 校验 `<Picture>/<Video>/<Audio>/<Subject>` 编号与有序引用一致；0 引用时对应标签集合也必须为空。
- 默认尺寸使用 `getDslMiddleSize(MINIMAX_H3_SIZES, vertical ? "9:16" : "16:9")`，尺寸 UI 只展示同方向预设，不开放手动数字输入。
- 删除资产/分镜 Markdown 的 `replaceScriptSegment` 权威编辑路径；保留的剧本正文替换也改为按集序号。

任何 JSON 解析、字段、资产引用或 H3 校验失败都返回具体错误，**不自动补全未知 ID、不猜测名称、不静默修正非法尺寸**。

### 4.4 修改 [script-generation.ts](file:///d:/infinite-canvas/web/src/lib/canvas/script-generation.ts)

- Markdown 阶段与结构化阶段分开编排，避免 `string | 数组` 混入同一返回值。
- 分集大纲支持一集和多集；`storyboard` 始终逐集走 H3 JSON，不再存在普通分镜回退。
- 分镜生成前要求每集都有对应正文；数量不一致或某集为空时立即报错，彻底移除 `scriptEpisodes[index] || script`。
- 全剧资产生成：完整响应通过校验后一次性替换；若已有分镜，则阻止全量资产重写并提示在故事板中逐项编辑，防止引用被整体破坏。
- 全剧分镜生成：逐集请求只用于显示进度，先收集全部原始结果；所有集均解析、交叉引用校验通过后一次性提交。任一集失败，保留完整旧分镜。
- 单集/单镜头重生成：仅目标范围通过完整校验后原子替换；失败保留该集/该镜头旧数据。
- `script` 阶段仍可沿用现有分段进度展示，但正文聚合和后续分镜都按集序号对应。

## 5. 弹窗与故事板编辑

### 5.1 修改 [canvas-script-adapt-dialog.tsx](file:///d:/infinite-canvas/web/src/components/canvas/canvas-script-adapt-dialog.tsx)

- `ScriptAdaptResult`、本地 state、自动保存、完成条件和 `onInsert` 全部改用结构化资产/分镜类型。
- 原文、设定、大纲、剧本编辑器保持不变；资产与分镜阶段改为只读结构摘要（数量、分集、错误和生成进度），详细编辑统一进入故事板，避免再维护一个 JSON/Markdown 编辑器。
- 分镜逐集生成期间只更新进度，不调用 `onPart` 写入半截 JSON；全部成功后一次更新 store。
- 修正以 `.trim()` 判断资产/分镜是否完成的旧逻辑，改为数组及必要镜头校验。

### 5.2 修改 [canvas-storyboard-view.tsx](file:///d:/infinite-canvas/web/src/components/canvas/canvas-storyboard-view.tsx)

- 左侧完整展示角色、场景、道具、视频、音频五个分区，以及分集和镜头；所有选择、定位和批量操作使用稳定 ID key。
- 资产编辑改为名称、说明、生成提示词字段，按 ID 更新；改名只改显示文本，不改变引用和节点身份。
- 上传根据资产类型动态限制 MIME：图片 `image/*`、视频 `video/*`、音频 `audio/*`，错误类型直接提示。
- 资产行展示未准备/生成中/失败/就绪状态；就绪只认对应画布节点已有有效媒体。
- 镜头编辑包括：标题、时长、H3 尺寸下拉、三类有序引用选择/上下移动/移除，以及六段 H3 文本。选择项以 ID 保存，同名资产用类型和短 ID 辅助区分。
- 实时显示 `validateH3Shot` 错误；存在错误、未知引用或媒体未准备时禁用对应生成动作，并给出具体原因。
- 单镜头剧本重生成只替换该 ID 的镜头；单镜头“生成/重新生成视频”允许对已有结果显式重跑，批量按钮默认只处理未就绪或失败项。
- 保留现有画布主题、扁平按钮和弹层 token，不新增页面级主题分支。

### 5.3 修改语言文件

在 [zh-CN.ts](file:///d:/infinite-canvas/web/src/i18n/locales/zh-CN.ts) 和 [en-US.ts](file:///d:/infinite-canvas/web/src/i18n/locales/en-US.ts) 同步五类资产、结构化编辑、引用排序、H3 校验、工作流不匹配及原子生成失败等文案；界面默认中文。

## 6. 节点计划、同步与上传

### 6.1 修改 [script-node.ts](file:///d:/infinite-canvas/web/src/lib/canvas/script-node.ts)

- `ScriptNodeSource` 直接接受版本 2 状态；`parse` 改为结构派生视图。
- 节点 key 固定为 `asset:${asset.id}`、`shot:${shot.id}`、`episode:${episode.id}`；显示名称和标题不再进入 key。
- 图片/视频/音频资产分别生成 Image/Video/Audio 节点；镜头生成 Video 节点，并输出 `prompt/seconds/size`。
- 镜头计划增加 H3 标识，供项目同步绑定内置 `omni-video-minimax-h3-ms-v10` 工作流，而不是沿用任意默认视频工作流。
- 连线严格按 `imageAssetIds → videoAssetIds → audioAssetIds` 及各数组内部顺序生成；资产文本节点与分镜文本节点只放派生摘要。

### 6.2 修改 [project.tsx](file:///d:/infinite-canvas/web/src/pages/canvas/project.tsx) 的剧本相关区域

**节点同步：**

- 已存在节点保留 ID、位置和用户尺寸；标题与结构化参数按 key 更新。
- 资产仅在其生成提示词变化时清空旧媒体；镜头仅在其 H3 提示词、时长、尺寸或引用签名变化时清空旧结果。名称/说明变化不清空媒体。
- 删除已不在计划中的剧本托管节点及其相关连接，避免残留旧镜头；解析/校验失败不会进入同步，因此不会误删。
- 镜头节点通过现有工作流查找能力绑定当前渠道的内置 `builtin-omni-video-minimax-h3-ms-v10`、`modelId: omni-video-minimax-h3-ms-v10` 和 `videoMode: omni`；当前渠道缺少该工作流时明确报错并引导恢复内置工作流。

**连线同步：**

- 剧本托管连线使用可识别的稳定 ID（如 `script-connection:${fromKey}:${toKey}`），只替换发生变化的托管连线，不再每次全删全建。
- 引用签名同时比较来源和顺序；单纯重新打开或同步不重置镜头结果。
- 不删除用户其他手动连线，但剧本镜头存在额外手动输入时，生成前明确失败，提示移除手动输入或先把资产加入分镜引用，确保实际 FIFO 与剧本唯一权威一致。

**媒体上传：**

- 将 `replaceScriptAssetImage` 泛化为按资产类型上传：图片继续使用 `uploadImage + imageMetadata`；视频/音频使用现有 `uploadMediaFile + videoMetadata/audioMetadata`。
- 写入对应节点 `metadata`、保留 `scriptKey`、更新画布状态并沿用 `createNodeProjectAsset`；视频保留尺寸、时长和封面元数据，音频保留时长元数据。
- 上传资产媒体不自动清空所有下游镜头旧成片；用户通过单镜头或批量重新生成显式更新，避免一次素材替换触发大量隐式任务。

**生成前最终预检：**

- 继续调用 `validateH3Shot`，再检查每个引用节点类型与 `metadata.content`。
- 使用现有 `buildNodeGenerationContext` 读取实际输入，将实际图片/视频/音频节点 ID 及顺序分别与分镜计划比较；任何额外、缺失、乱序或超限时均 Fail-loud，不提交 ComfyUI。
- 检查镜头模型确为 MiniMax H3 后，沿用 `generateNodeRef`；现有批量停止、失败计数、错误显示和结果写回保持原逻辑。

## 7. 明确复用、不重写的 H3 执行层

以下文件只作为联调核对点，本计划不改变其绑定算法：

- [video-minimax-h3-omni.ts](file:///d:/infinite-canvas/web/src/services/api/models/video-minimax-h3-omni.ts)：9/3/3、1～15 秒、12 档对称尺寸（横竖共 24 个精确尺寸字符串）及默认中间档。
- [canvas-node-generation.ts](file:///d:/infinite-canvas/web/src/components/canvas/canvas-node-generation.ts)：按画布连线收集有序图片、视频、音频引用。
- [comfyui.ts](file:///d:/infinite-canvas/web/src/services/api/comfyui.ts)：`media_state`/桥接计数、`ref_image_01..09`、`ref_video_01..03`、`ref_audio_01..03` 绑定，以及未使用槽位和级联节点修剪。
- [comfyui-default-workflows.ts](file:///d:/infinite-canvas/web/src/services/api/comfyui-default-workflows.ts) 与现有内置 `MS_V10.json`：镜头实际执行工作流。

不修改这六类核心 ComfyUI 插件要求，不增加 OpenH3-IR 节点，不引入外部闭源模型调用或代理层。

## 8. 实施顺序

1. 落地版本 2 类型、空状态、结构解析/校验和派生格式化。
2. 改造 Agent JSON 提示词与前端逐集/逐镜头原子生成，修正错集回退。
3. 改造改编弹窗和故事板五类资产、六段 H3、尺寸及有序引用编辑。
4. 改造节点计划、稳定 ID 同步、H3 工作流绑定、连线签名和三类媒体上传。
5. 接入生成前实际上下文一致性预检，完成失败保留旧状态与局部重生成。
6. 更新中英文文案、`CHANGELOG.md` 的 `Unreleased`、[todo.mdx](file:///d:/infinite-canvas/docs/content/docs/progress/todo.mdx) 与 [pending-test.mdx](file:///d:/infinite-canvas/docs/content/docs/progress/pending-test.mdx)。
7. 按项目规则不主动执行构建；检查实际 diff 后创建一次详细 Git commit，说明结构化契约、完整 9/3/3 链路、失败策略与待用户验收项。

## 9. 验收矩阵

实现后由用户使用真实本地 ComfyUI 验收，不能用“代码已写完”代替出片验证：

1. **基础路线**：短篇原文依次生成设定、两集大纲、两集剧本、全剧资产和两集 H3 分镜；每集正文严格对应，无整部剧本错发。
2. **五类媒体**：角色/场景/道具图片、参考视频、参考音频均可生成或上传，故事板状态与画布节点一致。
3. **引用梯度**：分别验证 0 引用、单图、单视频、单音频、混合引用，以及满配 9 图 + 3 视频 + 3 音频。
4. **顺序契约**：调整三类引用顺序后，生成上下文、`Picture/Video/Audio` 编号和最终 `ref_*` 槽位顺序完全一致；未满槽位及级联节点被修剪。
5. **稳定身份**：同名资产不串引用；资产、集名、镜头标题改名后节点 ID、连线和引用保持不变；跨集共享同一资产只生成一个资产节点。
6. **局部更新**：修改某镜头提示词/时长/尺寸/引用只失效该镜头；单镜头重生成不影响其他镜头和集。
7. **同步清理**：删除资产或镜头后，对应托管节点与连线消失；重复同步不重复建节点、不重建未变化连线、不清空已有成片。
8. **失败保留**：无效 JSON、缺少六段、未知资产 ID、非法尺寸、超过 9/3/3、缺本集正文、缺媒体及 H3 工作流缺失均显示明确错误，旧资产/旧分镜/旧节点结果不被覆盖。
9. **真实出片**：至少完成一个混合引用镜头和一个满配镜头的 ComfyUI 提交、状态回传、视频写回与显式重新生成；批量停止和单任务失败不阻塞其他已完结果。

## 10. 边界与假设

- 当前 Agent 文本生成配置保持不变；本计划只优化其资产/分镜协议，不讨论或新增文本模型渠道。
- 项目尚未上线，版本 1 剧本不做迁移；旧数据仅提示不兼容，不自动删除。
- 集身份按序号稳定，不在本次增加集拖拽排序。
- 剧本托管镜头只允许声明式资产引用参与生成，避免手动连线造成第二套引用顺序。
- 本次交付目标是“每个 H3 镜头可靠出片”，不包含整集视频拼接、字幕合成、时间线剪辑或发布平台导出。
