# 故事板与剧本创作 · 小说到成片 修改方案（含 UI 交互）

> 本方案是对现有两份文档的整合与升级：[script-storyboard-plan.md](file:///d:/infinite-canvas/.trae/documents/script-storyboard-plan.md)（已落地的 v1 故事板模式）与 [novel-to-h3-production-route.md](file:///d:/infinite-canvas/.trae/documents/novel-to-h3-production-route.md)（尚未落地的 v2 结构化路线），并补充两者都缺失的 **UI 交互规格**。
> 视觉规范基线沿用 [UI-REDESIGN-PLAN.md](file:///d:/infinite-canvas/2026-11-21/ui-redesign/outputs/UI-REDESIGN-PLAN.md) 的方向 A「静默工具台」。

---

## 0. 结论摘要

1. **数据升级**：把剧本从「一次性 Markdown 产物」升级为项目级结构化资产。原文 / 故事设定 / 分集大纲 / 分集正文继续用 Markdown；**全剧五类资产与分集分镜改为唯一权威的结构化数据**，画布上的「资产 / 分镜」文本节点只展示由结构派生的只读摘要，不再形成第二份可编辑权威。
2. **故事板升级**：从当前「只读式三栏 + 整段 textarea」升级为 **结构化编辑工作台**——五类资产分区、分集、镜头；镜头按字段编辑（时长、H3 尺寸、三类有序引用、六段 H3 文本），实时校验并 fail-loud。
3. **成片链路补齐 6 个断点**：错集回退、名称 key 串引用、全删全建连线、H3 工作流未绑定、生成前缺上下文一致性预检、视频/音频资产缺上传入口。
4. **UI 交互收敛**：画布内一律读 `canvasThemes`，扁平无底色按钮，工具条在上 / 输入在下，空态 / 加载 / 失败 / 禁用态全部有明确契约，文案进 i18n。

---

## 1. 现状盘点

### 1.1 已实现（v1）

- 项目级剧本状态 [CanvasScriptState](file:///d:/infinite-canvas/web/src/types/canvas.ts#L15-L32)（`version: 1`），只存六段原文。
- 剧本改编弹窗 [canvas-script-adapt-dialog.tsx](file:///d:/infinite-canvas/web/src/components/canvas/canvas-script-adapt-dialog.tsx)：6 步 Steps（原文 → 设定 → 大纲 → 剧本 → 资产 → 分镜），支持粘贴 / 上传 / 引用画布文本节点、长篇自动 `condense`、全局 / 项目 preamble。
- Markdown 解析层 [script-model.ts](file:///d:/infinite-canvas/web/src/lib/canvas/script-model.ts)：按标题正则解析集 / 资产 / 镜头，`validateH3Shot` 做基础校验。
- 故事板视图 [canvas-storyboard-view.tsx](file:///d:/infinite-canvas/web/src/components/canvas/canvas-storyboard-view.tsx)：左侧资产 + 集 + 镜头，右侧编辑器，底部批量工具栏。
- 节点计划与同步 [script-node.ts](file:///d:/infinite-canvas/web/src/lib/canvas/script-node.ts) + [project.tsx](file:///d:/infinite-canvas/web/src/pages/canvas/project.tsx#L953-L1098) 的 `syncScriptNodes / runScriptGeneration / replaceScriptAssetImage`。
- 模式切换 `use-canvas-view-store` + 顶栏菜单项「故事板」。
- 持久化 [use-script-store.ts](file:///d:/infinite-canvas/web/src/stores/canvas/use-script-store.ts)（400ms 防抖 + flush）。

### 1.2 断点（本方案要修的）

| # | 断点 | 位置 |
| --- | --- | --- |
| 1 | 资产 / 分镜以 Markdown 字符串保存，靠标题正则解析与替换，改名 / 重名 / 局部重生成不可靠 | [script-model.ts](file:///d:/infinite-canvas/web/src/lib/canvas/script-model.ts#L54-L101) |
| 2 | 引用 key 由名称生成（`asset:角色:林昭`），重名资产会串，跨集共享资产身份不稳定 | [script-model.ts](file:///d:/infinite-canvas/web/src/lib/canvas/script-model.ts#L71-L73) |
| 3 | 缺本集正文时回退整部剧本错发给单集 | [script-generation.ts](file:///d:/infinite-canvas/web/src/lib/canvas/script-generation.ts#L41) |
| 4 | 弹窗资产 / 分镜阶段是纯 textarea，无结构、无校验，用户手改极易破坏引用 | [canvas-script-adapt-dialog.tsx](file:///d:/infinite-canvas/web/src/components/canvas/canvas-script-adapt-dialog.tsx#L435-L440) |
| 5 | 故事板只展示角色 / 场景 / 道具，缺参考视频 / 音频分区；上传写死 `image/*` | [canvas-storyboard-view.tsx](file:///d:/infinite-canvas/web/src/components/canvas/canvas-storyboard-view.tsx#L175-L184), [L254](file:///d:/infinite-canvas/web/src/components/canvas/canvas-storyboard-view.tsx#L254) |
| 6 | 镜头编辑是整段 Markdown，无时长 / 尺寸 / 引用排序 / 六段分字段编辑 | [canvas-storyboard-view.tsx](file:///d:/infinite-canvas/web/src/components/canvas/canvas-storyboard-view.tsx#L302-L318) |
| 7 | 同步时每次删除并重建镜头全部输入连线，且不清理已从计划中消失的剧本节点 | [project.tsx](file:///d:/infinite-canvas/web/src/pages/canvas/project.tsx#L1011-L1017) |
| 8 | 镜头节点继承任意默认视频工作流，不保证走 MiniMax H3；生成前也不做实际上下文一致性校验 | [project.tsx](file:///d:/infinite-canvas/web/src/pages/canvas/project.tsx#L1091-L1092) |

---

## 2. 目标与范围

目标路线：

**小说 / 长文 → 故事设定 → 分集大纲 → 分集剧本 → 全剧五类资产 → 准备图片 / 视频 / 音频媒体 → 分集 H3 分镜 → 自动节点与有序连线 → 单镜头 / 批量 H3 出片。**

本迭代范围：

- 剧本创作：结构化资产与分镜生成、逐集 / 逐镜头原子重生成、错集回退修正。
- 故事板：五类资产 + 集 + 镜头的结构化编辑与批量能力。
- 成片：稳定 ID 节点同步、H3 工作流绑定、有序连线、三类媒体上传、生成前预检。
- UI 交互：以上全部交互的布局、状态、流程与文案规格。

明确不做：整集拼接 / 自动剪辑 / 字幕合成 / 时间线；通用 IR / DSL；旧剧本数据迁移；无关画布重构；新增外部模型或中间代理。

---

## 3. 唯一数据契约（version 2）

### 3.1 类型（[canvas.ts](file:///d:/infinite-canvas/web/src/types/canvas.ts)）

```ts
type ScriptAssetKind = "character" | "scene" | "prop" | "video" | "audio";

type ScriptAsset = {
    id: string;                 // 客户端 nanoid，持久化；重名/改名不改变
    kind: ScriptAssetKind;
    name: string;
    description: string;
    prompt: string;
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
    id: string;                 // 客户端 nanoid
    number: number;             // 集内顺序，从 1 开始
    title: string;
    duration: number;           // 整数 1~15 秒
    size: string;               // MINIMAX_H3_SIZES 精确值，如 768x1344
    imageAssetIds: string[];    // 仅 character/scene/prop，最多 9
    videoAssetIds: string[];    // 仅 video，最多 3
    audioAssetIds: string[];    // 仅 audio，最多 3
    h3: ScriptH3Prompt;
};

type ScriptStoryboardEpisode = {
    id: string;                 // episode_1、episode_2……
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

约束：

- 身份由客户端 `nanoid` 生成，模型只生成内容，不发明内部 ID；模型只能引用已存在的资产 ID。
- 集以序号稳定标识，集名仅用于显示；本迭代不做集拖拽排序。
- 媒体内容 / 生成状态 / 结果只存在画布节点 `metadata`，剧本状态不存 base64、URL 或冗余 `ready`。
- 映射：`character/scene/prop → Image`，`video → Video`，`audio → Audio`；就绪由节点类型与 `metadata.content` 派生。
- `formatH3Prompt(shot.h3)` 按固定六段顺序拼提交文本；显示用摘要由结构即时派生，不可反向编辑、不参与生成。
- 不做 version 1 迁移：遇到非 2 时保留原文件并显式提示不兼容，禁止静默清空 / 覆盖。

---

## 4. 剧本创作线（小说 → 剧本）

### 4.1 Agent 协议（[script.ts](file:///d:/infinite-canvas/canvas-agent/src/agent/script.ts)）

- `setting / outline / script` 保持现有 Markdown 输出。
- `assets` 改为只输出一个 JSON 对象：`{ "assets": [{ "kind", "name", "description", "prompt" }] }`；全剧一次提取、跨集合并同一资产，但身份不靠名称承担。
- `storyboard` 只支持明确的单集或单镜头 H3 JSON，**删除回退到普通图片分镜的旧分支**（[script.ts](file:///d:/infinite-canvas/canvas-agent/src/agent/script.ts#L348-L381)）。
- 单集返回 `{ "episode": { "title", "shots": [...] } }`；单镜头返回 `{ "shot": {...} }`，镜头字段不含内部 `id`。
- `ScriptGenerateInput` 增加可选 `shot: string`（当前镜头 JSON）+ 本集大纲 / 正文 / 全剧资产 / 用户反馈，返回一个替换镜头，不重写整集。
- 提示词明确：六段 H3 正文用英文；引用顺序即编号顺序；`<Picture N>/<Video N>/<Audio N>` 从 1 连续编号；时长 1~15 秒；尺寸只能取请求中提供的当前方向预设。

### 4.2 前端接口（[canvas-agent.ts](file:///d:/infinite-canvas/web/src/services/api/canvas-agent.ts#L167-L171)）

- 与 Agent 同步增加可选 `shot` 字段；响应仍是 `{ content: string }`，解析与校验放在前端模型层，接口层不静默转空数组。

### 4.3 解析与校验（[script-model.ts](file:///d:/infinite-canvas/web/src/lib/canvas/script-model.ts) 重写）

- `parseGeneratedAssets`：严格 JSON 解析 → 校验类型 / 非空 → 客户端分配 ID。
- `parseGeneratedEpisode` / `parseGeneratedShot`：完整校验后分配镜头 ID；单镜头替换沿用原 ID，整集替换保留集 ID、替换该集镜头。
- `buildScriptProjectView`：按大纲序号关联正文与结构化分镜，派生资产 / 集 / 镜头视图与稳定 `scriptKey`（`asset:${id}`、`shot:${id}`、`episode:${id}`），**集名不再参与关联**。
- `replaceEpisodeBlock`：按集序号替换 Markdown 正文，不再按可改标题正则定位。
- `validateH3Shot`：六段均非空、时长 1~15 整数、尺寸属于 `MINIMAX_H3_SIZES` 且方向正确、三类引用数量 / 重复 / 存在性 / 类型、`<Picture>/<Video>/<Audio>/<Subject>` 编号与有序引用一致。
- 删除资产 / 分镜的 Markdown `replaceScriptSegment` 权威编辑路径。
- 任何解析或校验失败都返回具体错误，**不补全未知 ID、不猜名称、不静默修正尺寸**。

### 4.4 编排（[script-generation.ts](file:///d:/infinite-canvas/web/src/lib/canvas/script-generation.ts)）

- Markdown 阶段与结构化阶段分开编排，避免 `string | 数组` 混入同一返回值。
- 分镜始终逐集走 H3 JSON；生成前要求每集都有正文，数量不一致或某集为空立即报错，**彻底移除 `scriptEpisodes[index] || script`**。
- 全剧资产：完整响应校验通过后一次性替换；若已有分镜，阻止全量资产重写并提示在故事板中逐项编辑。
- 全剧分镜：逐集请求只用于显示进度，先收集全部原始结果，全部解析 + 交叉引用校验通过后一次性提交；任一集失败保留完整旧分镜。
- 单集 / 单镜头重生成：仅目标范围通过校验后原子替换，失败保留旧数据。

### 4.5 弹窗交互（[canvas-script-adapt-dialog.tsx](file:///d:/infinite-canvas/web/src/components/canvas/canvas-script-adapt-dialog.tsx)）

- 原文 / 设定 / 大纲 / 正文四步保持富文本编辑，不改交互。
- **资产 / 分镜两步改为只读结构摘要**：展示数量、按类分组、分集镜头数、校验错误与生成进度；详细编辑统一进故事板，避免再维护一个 JSON / Markdown 编辑器。
- 分镜逐集生成期间只更新进度条，不写半截 JSON；全部成功后一次更新 store。
- 完成条件从 `.trim()` 判断改为「数组 + 必要镜头校验通过」。

---

## 5. 故事板工作台（结构化编辑）

### 5.1 布局

```
┌──────────────────────────────────────────────────────────────────┐
│ 顶栏：← 返回 │ 面板 菜单 │ 标题 │ 画布/故事板 │ 连接 协作 Agent   │  52~56px
├───────────────┬──────────────────────────────────────────────────┤
│ 资产区 280px  │ 右侧内容区（随选中切换）                          │
│ ─ 角色        │  · 资产：预览 / 说明 / 提示词 / 生成·上传·定位      │
│ ─ 场景        │  · 分集：正文编辑 / 重新生成本集                   │
│ ─ 道具        │  · 镜头：标题·时长·尺寸·三类引用·六段 H3 / 校验     │
│ ─ 参考视频    │                                                  │
│ ─ 参考音频    │                                                  │
│ ─ 分集        │  ↑ 内容独立滚动                                  │
│ ─ 镜头        │                                                  │
├───────────────┴──────────────────────────────────────────────────┤
│ 底栏：生成所有资产 │ 生成所有人物 │ 生成所有分镜 │ 上传 │ 停止 │ 进度 x/y 重试失败 回到画布定位 │
└──────────────────────────────────────────────────────────────────┘
```

- 左侧新增「参考视频 / 参考音频」两个分区，五类资产分区顺序固定：角色 / 场景 / 道具 / 参考视频 / 参考音频。
- 分区标题 11px 次级色；行高 32，hover 用 `surface.hover`，选中用 `surface.active`（仅表达状态，不作装饰底色）。
- 左右区之间 1px hairline；底栏顶部 1px hairline，无阴影、无胶囊底。

### 5.2 镜头编辑器（核心）

字段与控件：

| 字段 | 控件 | 约束 |
| --- | --- | --- |
| 标题 | Input | 非空 |
| 时长 | InputNumber | 整数 1~15 秒 |
| H3 尺寸 | Select | 只列当前方向预设，无自由数字输入；默认取该方向中间档 |
| 参考图片 | 多选 + 上下移动 + 移除 | 仅 character/scene/prop，≤9，顺序即编号 |
| 参考视频 | 多选 + 上下移动 + 移除 | 仅 video，≤3 |
| 参考音频 | 多选 + 上下移动 + 移除 | 仅 audio，≤3 |
| 六段 H3 | 六个 TextArea | 每段非空 |

- 同名资产用「类型 + 短 ID」辅助区分（如 `角色 · 林昭 · a3f2`），引用以 ID 保存。
- 实时跑 `validateH3Shot`，错误以列表形式显示在字段下方；存在错误 / 未知引用 / 媒体未就绪时禁用「生成视频」，并给出具体原因。
- 引用资源的选择器复用现有 [canvas-resource-mention-menu.tsx](file:///d:/infinite-canvas/web/src/components/canvas/canvas-resource-mention-menu.tsx) 的资产展示语言，保持一致。

### 5.3 资产编辑器

- 字段：名称、说明（多行）、生成提示词；按 ID 更新，改名只改显示文本，不改引用与节点身份。
- 上传按类型动态限制 MIME：图片 `image/*`、视频 `video/*`、音频 `audio/*`，类型不符直接提示。
- 资产行状态：未准备 / 生成中 / 失败 / 就绪；就绪只认对应画布节点已有有效媒体。

### 5.4 校验与禁用规则（fail-loud）

- 任何 `validateH3Shot` 错误、未知引用、媒体未准备、H3 工作流缺失，都禁用对应生成动作并显示原因。
- 单镜头「生成 / 重新生成视频」允许对已有结果显式重跑；批量按钮默认只处理未就绪或失败项。

---

## 6. 小说到成片执行线

### 6.1 节点计划（[script-node.ts](file:///d:/infinite-canvas/web/src/lib/canvas/script-node.ts)）

- `ScriptNodeSource` 直接接受 version 2 状态；`parse` 改为结构派生视图。
- 节点 key 固定 `asset:${asset.id}` / `shot:${shot.id}` / `episode:${episode.id}`，显示名与标题不进入 key。
- 五类资产分别生成 Image / Video / Audio 节点；镜头生成 Video 节点并输出 `prompt / seconds / size`。
- 镜头计划带 H3 标识，供同步绑定内置 `omni-video-minimax-h3-ms-v10`（工作流 `builtin-omni-video-minimax-h3-ms-v10`，`videoMode: omni`）。
- 连线严格按 `imageAssetIds → videoAssetIds → audioAssetIds` 及数组内部顺序生成。

### 6.2 节点同步（[project.tsx](file:///d:/infinite-canvas/web/src/pages/canvas/project.tsx#L953-L1027) 剧本区域）

- 已存在节点保留 ID、位置、用户尺寸；标题与结构化参数按 key 更新。
- 资产仅在生成提示词变化时清空旧媒体；镜头仅在 H3 提示词 / 时长 / 尺寸 / 引用签名变化时清空旧结果；名称 / 说明变化不清空。
- 删除已不在计划中的剧本托管节点及其连线。
- 镜头节点缺 H3 内置工作流时明确报错并引导恢复内置工作流。

### 6.3 连线同步

- 托管连线使用稳定 ID（如 `script-connection:${fromKey}:${toKey}`），只替换发生变化的托管连线，不再每次全删全建。
- 引用签名同时比较来源与顺序；单纯重开或同步不重置镜头结果。
- 不删除用户手动连线；镜头存在额外手动输入时生成前明确失败，提示移除或把资产加入分镜引用。

### 6.4 媒体上传

- 把 `replaceScriptAssetImage` 泛化为按类型上传：图片 `uploadImage + imageMetadata`；视频 / 音频 `uploadMediaFile + videoMetadata/audioMetadata`。
- 写入对应节点 `metadata`、保留 `scriptKey`、更新画布状态并沿用 `createNodeProjectAsset`。
- 上传不自动清空所有下游镜头旧成片，由用户显式重跑。

### 6.5 生成前最终预检

- 先 `validateH3Shot`，再检查每个引用节点类型与 `metadata.content`。
- 用现有 `buildNodeGenerationContext` 读取实际输入，将实际图片 / 视频 / 音频节点 ID 与顺序分别与分镜计划比较；任何额外 / 缺失 / 乱序 / 超限都 fail-loud，不提交 ComfyUI。
- 确认镜头模型为 MiniMax H3 后沿用 `generateNodeRef`；现有批量停止、失败计数、错误显示、结果写回保持原逻辑。

---

## 7. UI 交互设计

### 7.1 设计基线

- 一律读 [canvas-theme.ts](file:///d:/infinite-canvas/web/src/lib/canvas-theme.ts) 的 `canvasThemes`，不得写 `stone-*` / hex / `dark:` 分支。
- 语义 token 与尺寸沿用 UI-REDESIGN-PLAN 的 Phase 0（`surface / hairline / text / state`，控件高 32、图标按钮 32、输入 34）。
- 画布工具栏与故事板底栏保持「无边框、无阴影、无胶囊底、仅轻微 hover」。

### 7.2 模式切换

- 顶栏「画布 / 故事板」切换保留在视图菜单（[canvas-top-bar.tsx](file:///d:/infinite-canvas/web/src/components/canvas/canvas-top-bar.tsx#L110-L112)），切换即时生效，无需二次确认。
- 故事板模式下隐藏左侧节点面板与底部画布工具栏，`CanvasScene` 保持挂载以保留视口与节点状态，屏蔽画布快捷键与拖拽。
- 从故事板「定位」跳回画布时，自动切回画布模式并聚焦目标节点。

### 7.3 关键交互流程

**剧本生成流（弹窗）**

```
原文 → [下一步] → 设定 → [下一步] → 大纲 → [下一步] → 正文(逐集进度) →
资产(JSON 生成 + 摘要) → 分镜(逐集 H3 JSON) → [写入画布]
        ↑ 任意步可回退、可填反馈重新生成；任一步失败保留旧内容并就地报错
```

**局部重生成流（故事板）**

```
选中某集/某镜 → 点「重新生成」 → 单次 Agent 请求(带目标范围) →
校验目标段存在且合法 → 原子替换该段 → 更新对应节点；失败则整段保持原样
```

**批量生成流（故事板底栏）**

```
点「生成所有资产 / 人物 / 分镜」 → 预检(配置 + 校验 + 媒体就绪) →
串行提交(ComfyUI 排队) → 进度 x/y · 失败 n → 可停止 → 结束后汇总「重试失败」
```

**上传替换流**

```
选中资产 → 点「上传」 → 按类型过滤文件 → 上传 → 写回节点 metadata → 资产状态转「就绪」
```

### 7.4 状态契约

| 状态 | 表现 |
| --- | --- |
| 空（无剧本） | 居中 Empty + 单主按钮「去生成剧本」 |
| 加载中 | 骨架 / 行内 spinner，不阻断其他分区 |
| 生成中 | 对应行状态点转警示色，底部进度条 `x/y` |
| 失败 | 行状态点转危险色，字段下方错误列表 + 底部「重试失败」 |
| 禁用 | 生成按钮置灰 + Tooltip 说明原因（校验错误 / 媒体未就绪 / 工作流缺失） |
| 就绪 | 状态点转成功色 |

### 7.5 文案与 i18n

- 在 [zh-CN.ts](file:///d:/infinite-canvas/web/src/i18n/locales/zh-CN.ts) 与 [en-US.ts](file:///d:/infinite-canvas/web/src/i18n/locales/en-US.ts) 同步五类资产、结构化编辑、引用排序、H3 校验、工作流不匹配、原子生成失败等文案；界面默认中文。

---

## 8. 组件与文件改动清单

| 层 | 文件 | 改动 |
| --- | --- | --- |
| 类型 | [types/canvas.ts](file:///d:/infinite-canvas/web/src/types/canvas.ts) | `CanvasScriptState` 升 v2，新增 `ScriptAsset / ScriptShot / ScriptH3Prompt / ScriptStoryboardEpisode` |
| 存储 | [use-script-store.ts](file:///d:/infinite-canvas/web/src/stores/canvas/use-script-store.ts) | 版本 2 读写，修正空状态入参，非 2 显式不兼容 |
| 解析 | [script-model.ts](file:///d:/infinite-canvas/web/src/lib/canvas/script-model.ts) | 重写为 JSON 解析 / 校验 / 派生 / 格式化 |
| 编排 | [script-generation.ts](file:///d:/infinite-canvas/web/src/lib/canvas/script-generation.ts) | 结构化阶段拆分、原子生成、修正错集回退 |
| Agent | [canvas-agent/src/agent/script.ts](file:///d:/infinite-canvas/canvas-agent/src/agent/script.ts) | assets / storyboard 改 JSON，新增单镜头 `shot` |
| 接口 | [services/api/canvas-agent.ts](file:///d:/infinite-canvas/web/src/services/api/canvas-agent.ts) | 增加可选 `shot` |
| 弹窗 | [canvas-script-adapt-dialog.tsx](file:///d:/infinite-canvas/web/src/components/canvas/canvas-script-adapt-dialog.tsx) | 资产 / 分镜改只读摘要，结构化类型接入 |
| 故事板 | [canvas-storyboard-view.tsx](file:///d:/infinite-canvas/web/src/components/canvas/canvas-storyboard-view.tsx) | 五类分区、镜头字段化编辑、引用排序、上传 MIME、状态与校验 |
| 节点 | [script-node.ts](file:///d:/infinite-canvas/web/src/lib/canvas/script-node.ts) | v2 结构派生、稳定 key、H3 工作流标识、有序连线 |
| 画布 | [pages/canvas/project.tsx](file:///d:/infinite-canvas/web/src/pages/canvas/project.tsx) | 同步签名、清理、三类上传、生成前预检 |

---

## 9. 实施顺序

1. 落地 version 2 类型、空状态、结构解析 / 校验 / 派生格式化。
2. 改造 Agent JSON 提示词与前端逐集 / 逐镜头原子生成，修正错集回退。
3. 改造改编弹窗只读摘要与故事板五类资产、六段 H3、尺寸、有序引用编辑。
4. 改造节点计划、稳定 ID 同步、H3 工作流绑定、连线签名、三类媒体上传。
5. 接入生成前实际上下文一致性预检，完成失败保留旧状态与局部重生成。
6. 更新中英文文案、[CHANGELOG.md](file:///d:/infinite-canvas/CHANGELOG.md) 的 `Unreleased`、[todo.mdx](file:///d:/infinite-canvas/docs/content/docs/progress/todo.mdx) 与 [pending-test.mdx](file:///d:/infinite-canvas/docs/content/docs/progress/pending-test.mdx)。

---

## 10. 验收矩阵

实现后由用户使用真实本地 ComfyUI 验收：

1. **基础路线**：短篇原文依次生成设定、两集大纲、两集剧本、全剧资产、两集 H3 分镜；每集正文严格对应，无错发。
2. **五类媒体**：角色 / 场景 / 道具图片、参考视频、参考音频均可生成或上传，故事板状态与画布节点一致。
3. **引用梯度**：0 引用、单图、单视频、单音频、混合、满配 9 图 + 3 视频 + 3 音频。
4. **顺序契约**：调整引用顺序后，生成上下文、`Picture/Video/Audio` 编号与最终 `ref_*` 槽位顺序一致；未满槽位与级联节点被修剪。
5. **稳定身份**：同名资产不串引用；资产 / 集名 / 镜头标题改名后节点 ID、连线、引用不变；跨集共享资产只生成一个节点。
6. **局部更新**：改某镜头提示词 / 时长 / 尺寸 / 引用只失效该镜头；单镜重生成不影响其他。
7. **同步清理**：删资产或镜头后对应节点与连线消失；重复同步不重复建节点、不重建未变化连线、不清空已有成片。
8. **失败保留**：无效 JSON、缺六段、未知 ID、非法尺寸、超 9/3/3、缺本集正文、缺媒体、缺 H3 工作流均明确报错，旧数据不被覆盖。
9. **真实出片**：完成一个混合引用镜头与一个满配镜头的 ComfyUI 提交、状态回传、视频写回与显式重生成；批量停止与单任务失败不阻塞其他已完结果。

---

## 11. 边界与假设

- Agent 文本生成配置保持不变，本方案只优化资产 / 分镜协议。
- 项目尚未上线，version 1 剧本不迁移，旧数据仅提示不兼容，不自动删除。
- 集身份按序号稳定，本次不做集拖拽排序。
- 剧本托管镜头只允许声明式资产引用参与生成，避免手动连线造成第二套引用顺序。
- 本次目标是「每个 H3 镜头可靠出片」，不含整集拼接、字幕、时间线剪辑、发布导出。
- 协同不同步 `script`：故事板为本地编辑视图，需在 UI 标注，避免误导为多人实时。
