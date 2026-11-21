# 剧本项目化与故事板模式

## Context

当前「剧本改编」的五阶段文本只存在弹窗的组件 state 里，关闭即丢，只能一次性写入画布节点，之后既不能回到剧本文本继续调整，也没有按分镜浏览的视图。用户需要：

- 剧本成为项目级数据，随时回来继续编辑，能单段（某一集 / 某一镜 / 某个资产）重新生成或手改。
- 画布支持「故事板 / 画布」双模式切换：故事板按分镜排列，可生成对应资产；切回画布看到实际生成节点。
- 批量能力：一键生成所有资产、只生成所有人物、上传已有资产替换。
- 故事板布局：左侧资产、右侧文本内容、下方工具栏。

目标是把「剧本」从一次性的生成产物，升级成项目的可编辑资产，并让故事板成为这套数据的可视化工作台。

## 数据模型

### 项目级剧本状态

在 `web/src/types/canvas.ts` 的 `CanvasProject` 增加可选字段：

```ts
type CanvasScriptState = {
    version: 1;
    updatedAt: string;
    source: string;
    condensed: string;
    options: ScriptAdaptOptions;
    setting: string;
    outline: string;
    script: string;
    assets: string;
    storyboard: string;
};

type CanvasProject = { ...; script?: CanvasScriptState };
```

- 只存原始五阶段文本，不存解析后的实体，避免双份真相。
- 集、镜头、资产由新增的 `web/src/lib/canvas/script-model.ts` 解析得出：`parseScriptProject(script)` 返回 `episodes[] / assets[] / shots[]`。
- 实体 key 稳定：`asset:角色:林昭`、`shot:第1集:镜3`、`episode:第1集`，用于节点与文本互相定位。
- `version !== 1` 时显式报错，不做降级。

### 持久化

- 浏览器：扩展 `web/src/services/project-storage.ts` 的 `updateStoredProject`，patch 支持 `script`，与 `title/activeCanvasId` 同样合并写回。
- 桌面端：`web/server/storage-files.mjs` 的 `updateProject` 接受 `patch.script`，校验为对象且 `version === 1`，其余字段原样保存。
- 新增 `web/src/stores/canvas/use-script-store.ts`：按 `projectId` 载入、400ms 防抖保存、切模式/关闭弹窗/pagehide 强制 flush；保存失败显式提示，不静默丢弃。
- 不提升 `CANVAS_SCHEMA_VERSION`，旧项目无 `script` 视为空。

### 与画布节点映射

- 节点 `metadata` 增加 `scriptKey?: string`（如 `asset:角色:林昭`、`shot:第1集:镜3`）。
- 每个实体在节点侧只记录 `scriptKey`，不反向存 nodeId；查找节点时按 `scriptKey` 扫描当前画布节点，避免节点删除/撤销后悬空。
- 写入画布逻辑由现有 `insertScriptToCanvas` 演进为 `syncScriptNodes`：已存在同 `scriptKey` 的节点只更新 `title` 与 `prompt`，缺失的才新建，删除剧本段不自动删节点。

## UI 方案

### 模式切换

- 新增 `web/src/stores/use-canvas-view-store.ts`：`mode: "canvas" | "storyboard"`，localStorage 持久化，不写入项目文档。
- 顶栏 [canvas-top-bar.tsx](file:///d:/infinite-canvas/web/src/components/canvas/canvas-top-bar.tsx) 在剧本入口旁放 `Segmented`「画布 / 故事板」。
- [project.tsx](file:///d:/infinite-canvas/web/src/pages/canvas/project.tsx) 故事板模式下隐藏左侧面板与底部画布工具栏，渲染覆盖层；`CanvasScene` 保持挂载以保留视口与节点状态，但屏蔽画布快捷键与拖拽交互。

### 故事板视图

新增 `web/src/components/canvas/canvas-storyboard-view.tsx`，三区布局，配色沿用 `canvasThemes`，不硬编码黑白：

- 左侧 280px：资产列表，按「人物 / 场景 / 道具」分组，显示缩略图或图标、生成状态点；顶部提供「上传资产」入口。
- 右侧内容区：
  - 选中资产：展示描述、图像提示词（可编辑）、关联图片节点状态、生成/重新生成/上传替换。
  - 选中集：展示该集剧本正文（可编辑），支持「重新生成本集」。
  - 选中镜头：展示画面/台词/音效/AI 提示词（可编辑），支持「重新生成本镜」「生成视频」。
- 下方工具栏：`生成所有资产`、`生成所有人物`、`生成所有分镜视频`、`上传资产`、进度 `x/y`、`停止`、`重试失败`、`回到画布定位`。
- 编辑文本后同步更新对应节点 `title`/`prompt`，不自动触发生成。

### 单段重新生成

- 复用现有 Agent `/agent/script/generate`：集级沿用 `episode/episodeOutline`；镜头级传入整集分镜 + `feedback: 只重写该镜，其余保持不变`，返回后解析目标镜，找不到即报错并保留原文（fail-loud）。
- 资产重生成沿用按集资产拆解，或用单资产提示词重写；同样只替换目标段。

## 批量生成与上传

- `syncScriptNodes` 负责补齐节点：缺失的用 `createCanvasNode` + `createDefaultNodeMetadata(config)` 建在现有内容右侧，并把 `scriptKey` 写回 metadata。
- 批量生成串行执行（ComfyUI 本身排队），复用 `generateNodeRef.current(nodeId, "image" | "video", prompt)` 与 `startGenerationRequest/finishGenerationRequest`；生成前用 `isAiConfigReady` 预检。
- 「生成所有资产」只处理还没有成功图片的资产节点；「生成所有人物」按 `asset.kind === "character"` 过滤；失败不中断，结束后汇总并支持重试失败项；支持停止标记，停止后不再提交下一个。
- 上传替换：隐藏 `input[type=file]`，复用 `uploadImage(file, projectId)` 与 `imageMetadata`，更新目标节点并 `createNodeProjectAsset` 回写 `assetId`。

## 实施阶段

1. **数据层**：`types/canvas.ts`、`services/project-storage.ts`、`web/server/storage-files.mjs`、`stores/canvas/use-script-store.ts`、`lib/canvas/script-model.ts`（解析与 key 生成）。
2. **弹窗接入持久化**：`canvas-script-adapt-dialog.tsx` 改为读写 `useScriptStore`；抽出逐集生成循环到 `lib/canvas/script-generation.ts` 供弹窗与故事板共用。
3. **节点同步**：新增 `lib/canvas/script-node.ts`，`project.tsx` 用 `syncScriptNodes` 替换 `insertScriptToCanvas`，复用现有 `splitScriptEpisodes / splitAssetBlocks / splitStoryboardShots / promptField`。
4. **故事板骨架**：`use-canvas-view-store`、顶栏切换、`project.tsx` 条件渲染、`canvas-storyboard-view.tsx` 三栏布局与选中态。
5. **单段能力**：资产/集/镜头编辑与重新生成、节点定位（复用画布 `focusNode` 类逻辑或设置 viewport）。
6. **批量与上传**：批量生成、生成人物、上传替换、进度与停止。
7. **收尾**：中英文案、`CHANGELOG.md`、`docs/content/docs/progress/pending-test.mdx`。

## 验证

- 浏览器 dev：生成一次完整剧本 → 关闭弹窗并刷新 → 重新打开剧本仍能看到五阶段内容。
- 切到故事板：左侧资产分组正确，右侧可编辑并同步到画布节点；切回画布能看到对应图片/视频节点。
- 单段：只重新生成第 2 集、只重新生成某镜，确认其他段不变。
- 批量：生成所有资产 / 仅人物，观察进度与失败汇总；上传一张图替换某角色资产，画布节点同步更新。
- 桌面端打包后重复上述持久化与双模式验证。

## 风险与取舍

- `project.tsx` 体量大：只新增薄回调，解析、布局、批量逻辑全部放在独立文件。
- 协同不同步 `script`：故事板为本地编辑视图，需在 UI 标注；避免误导为多人实时。
- 镜头级重生成依赖模型遵守约束，必须校验目标段存在后再替换。
- 项目文档体积增加（原文上限 6 万字 + 分集文本），暂不接受流式保存以外的额外优化。
