# 画布持久化调研与改造方案

> 只读调研结论，未改任何代码。调研对象：`d:\infinite-canvas` 与 `y:\XQWCanvas`（小青蛙画布安装副本）。

## 1. 结论速览

1. 当前项目有**两套互不相通的持久化后端**：浏览器跑用 localForage/IndexedDB；Tauri 桌面版用本机 Node Sidecar（`127.0.0.1:18080`）写系统应用数据目录。
2. 「项目丢失」最可能不是写入逻辑崩了，而是**数据结构升级后没有迁移**：仓库源码已经是“项目 → 多张画布”，但本机桌面运行版打包的 Sidecar 还是“一个 project.json = 一张画布”。实测磁盘上的项目数据正是旧格式，升级后会被读成 0 张画布。
3. 其次是**关闭窗口/崩溃时未 flush 400ms 防抖中的修改**，以及**保存失败只弹一次 toast、不重试**。
4. XQWCanvas 的做法是“项目 = 用户自选文件夹，画布 = 目录里的 `*.json` 文件，素材 = `assets/` 子目录”，写入原子化（tmp + rename）、500ms 防抖 + 串行写、退出前强制等待保存。它的核心优势不是代码，而是**数据形态是用户可见、可备份、可迁移的普通文件**。
5. 推荐先做「方案 A：保留现有 Sidecar 结构，只补落盘可靠性」，工作量中等、风险低；「方案 B：整体对齐 XQW 的文件化项目」属于中大型重构，收益是数据可控性，代价是节点/资产/协同链路都要跟着改。

## 2. 当前项目持久化现状

### 2.1 两套后端与判定方式

| 运行形态 | 判定 | 数据落点 |
| --- | --- | --- |
| 浏览器（`bun run dev`、Docker/静态部署） | `VITE_STORAGE_SERVER_URL` 为空 | localForage → IndexedDB，库名 `infinite-canvas` |
| Tauri 桌面版 | 构建时 `TAURI_ENV_PLATFORM` 存在，URL 被写死为 `http://127.0.0.1:18080` | `%APPDATA%\com.imihoo.infinite-canvas\storage` |

- 注入逻辑：[vite.config.ts](file:///d:/infinite-canvas/web/vite.config.ts) 的 `define`。
- 健康探活与请求封装：[storage.ts](file:///d:/infinite-canvas/web/src/services/api/storage.ts#L15-L44)。
- 桌面端启动 Sidecar：[main.rs](file:///d:/infinite-canvas/web/src-tauri/src/main.rs#L20-L34)（`PORT=18080`、`INFINITE_CANVAS_DATA_DIR=<app_data_dir>/storage`）。
- 桌面端存储服务：[desktop-server.mjs](file:///d:/infinite-canvas/web/server/desktop-server.mjs)、[storage-files.mjs](file:///d:/infinite-canvas/web/server/storage-files.mjs)。

### 2.2 关键调用链

**画布项目**

- 统一读写入口：[project-storage.ts](file:///d:/infinite-canvas/web/src/services/project-storage.ts#L17-L24)，每个操作内部 `hasStorageServer()` 二选一。
- 本地键位：
  - 项目列表 `infinite-canvas:canvas_project_index`
  - 项目 `infinite-canvas:canvas_project:{id}`
  - 画布索引 `infinite-canvas:canvas_index:{id}`
  - 画布 `infinite-canvas:canvas_document:{projectId}:{canvasId}`
  - 项目素材 `infinite-canvas:project_assets:{id}`
  - 全局素材 `infinite-canvas:asset_store`（[use-asset-store.ts](file:///d:/infinite-canvas/web/src/stores/use-asset-store.ts#L46-L79)）
- 保存调度：[use-canvas-store.ts](file:///d:/infinite-canvas/web/src/stores/canvas/use-canvas-store.ts#L173-L233)，400ms 防抖 + 每个画布一条串行队列；`persistCanvas` 失败只写 `storageError`。
- 读取/打开：[use-canvas-store.ts](file:///d:/infinite-canvas/web/src/stores/canvas/use-canvas-store.ts#L306-L329)，打开前 `flushProject()`，找不到画布会自动新建一张。
- 卸载 flush：[project.tsx](file:///d:/infinite-canvas/web/src/pages/canvas/project.tsx#L666-L669)。

**媒体文件**

- 浏览器：图片 Blob 存 localForage `image_files`，其他媒体 `media_files`（[image-storage.ts](file:///d:/infinite-canvas/web/src/services/image-storage.ts#L17-L20)）。
- 桌面：`projects/<项目>/media/<媒体ID>`、全局 `assets/media/...`，原子流式写入。

**桌面磁盘实际结构（当前源码）**

```
storage/
  projects/index.json                 # 项目摘要列表
  projects/<项目ID>/project.json      # 仅项目元数据
  projects/<项目ID>/canvases/index.json
  projects/<项目ID>/canvases/<画布ID>.json
  projects/<项目ID>/assets.json
  projects/<项目ID>/media/<媒体ID>(+.mime)
  assets/assets.json
  assets/media/...
```

**导入/导出**

- 导出：Zip，内含 `projects.json`（`app: infinite-canvas`、`version: 3`）与 `projects/<id>/files/*`（[canvas-export.ts](file:///d:/infinite-canvas/web/src/lib/canvas/canvas-export.ts#L11-L29)）。
- 导入：解析后 `importProject` 重新分配 ID 并落盘（[canvas/index.tsx](file:///d:/infinite-canvas/web/src/pages/canvas/index.tsx)、[use-canvas-store.ts](file:///d:/infinite-canvas/web/src/stores/canvas/use-canvas-store.ts#L250-L305)）。
- 结论：**有手动备份能力，没有自动备份**。

### 2.3 已核实的“丢失”证据

本机桌面数据目录 `C:\Users\Administrator\AppData\Roaming\com.imihoo.infinite-canvas\storage` 里只有一个项目：

```
projects/uP8ekjveDJqbvvp2iFi4a/project.json   76 KB，含 nodes[6] / connections / chatSessions / viewport
projects/uP8ekjveDJqbvvp2iFi4a/media/*        5 个媒体文件
projects/index.json
```

**没有 `canvases/` 目录**。而当前源码 `storage-files.mjs` 要求 `project.json` 只放元数据、画布在 `canvases/<id>.json`。

同时 `web/src-tauri/target/release/server/storage-files.mjs`（正在运行的桌面版打包资源）里 `canvases` 出现次数为 0，`assertProject` 明确要求 `project.nodes` 是数组——即**运行中的 build 仍是旧的单文件单画布格式**，而仓库源码已经改成多画布。

用户看到的“项目没了/画布空白”就是这个原因：source 重新构建后，`listStoredCanvases` 找不到索引会返回 `[]`，`openProject` 自动新建一张空画布；旧 `nodes` 仍留在 `project.json` 里（新代码 `touchProject` 用展开赋值，不会删掉这些字段），所以**数据可恢复，但界面上完全看不到**。

## 3. 丢失根因排序

**R1｜数据结构升级未迁移（最高，已证实）**
源码多画布化，运行版还是单画布；已存在项目升级后读成 0 画布。旧内容在 `project.json`，需要一次性拆分脚本或直接丢弃（按 AGENTS.md 不写运行时兼容）。

**R2｜浏览器模式全量数据在 IndexedDB（高）**
清站点数据、隐私模式、浏览器存储回收、换浏览器/换域名都会导致“全丢”，且没有自动备份，只有手动导出 Zip。

**R3｜关窗/崩溃丢失最后 400ms 修改（高）**
只有页面路由卸载时 `void flushProject()`，没有 `beforeunload`/`pagehide`，也没有 Tauri `onCloseRequested` 等待保存；`main.rs` 退出时直接 kill Sidecar，在途请求会被掐断。

**R4｜保存失败被吞、不重试（中高）**
`persistCanvas` 捕获异常只 `setState({ storageError })`；界面是一次 `message.error`。桌面版 `saveCanvas` 有 revision 校验，一次 409 之后该画布所有后续保存持续失败，直到重新加载。没有任何“未保存”状态标识或离页拦截。

**R5｜浏览器端多键写入非原子（中）**
`createStoredProject` 依次写项目、画布索引、每张画布、项目素材，最后才写项目列表。中途失败/断电：项目数据在、列表里没有（看起来“丢了”）。另外索引是 read-modify-write，并发保存多张画布没有串行化，可能互相覆盖摘要。

**R6｜两套存储互不相见（中）**
同一份代码用 `bun run dev` 打开浏览器和用桌面版打开，数据完全不同。用户很容易把“在浏览器里看不到桌面项目”理解成丢失。

**R7｜Sidecar 探活失败即视为无存储服务（中低）**
`hasStorageServer()` 只等 1.5s、带 URL 时重试 20×100ms，失败直接抛“本地磁盘存储服务连接失败”。冷启动慢或 18080 被占用时，列表为空并报错。

**R8｜媒体清理误删（低，但存在）**
`cleanupUnusedImages` 在初始化后延迟执行，依据“当前素材 + 所有项目”收集 key；如果某项目读取失败（比如 R1 那种损坏/半写状态），其独占媒体会被判成未使用而删除。

## 4. `y:\XQWCanvas` 对照分析

### 4.1 可读性与性质

- 路径可读。它不是源码仓库，而是**Electrobun（Bun）安装目录**：`app/bin/*`、`app/Resources/app/{bun,views,nodes,tools,skills,providers,ext}`、`data/*`、`self-extraction/*.7z`。
- 它是安装副本：`xqwcanvas.ini` 里 `installDirectory=e:\XQWCanvas`，`settings.json` 记录的素材库与项目路径都在 `E:`，而本机 `E:` 不可访问。因此只能分析行为，不能验证用户真实项目文件。

### 4.2 技术栈与画布结构

- 桌面壳：Electrobun + Bun，主进程 `main.js` 加载 `bun/index.js`（15.8 MB 打包产物）。
- 前端：Vue 3 + Pinia + Element Plus / TDesign；图编辑用 **Vue Flow**（节点/边）；另有 Three.js（3D 导演节点）、Tiptap、Cytoscape、CodeMirror。
- 节点类型是**外部 UMD 插件**：`data/nodes/imageNode.umd.js`、`textNode`、`imageGenerationNode`、`videoGenerationNode`、`audioNode`、`director3dNode` 等；`data/ext/*` 是文档标签页扩展。节点工具由 `data/tools/*.tool.js` 通过 Agent 调用。
- 画布文件自带校验标记：`{ "xqwCanvas": true, nodes, edges, viewport }`；读取时校验 nodes/edges 数组、viewport 数值、节点 ID 是合法路径段；单文件上限 256 MB；扫描项目目录时跳过 `assets` 子目录，只认带标记的 `*.json`。

### 4.3 落盘机制

- **项目 = 文件夹**：新建项目时让用户选空文件夹（“画布和素材将保存在其中”），初始写入 `画布1.json`；每张画布是独立 JSON 文件，重命名画布同时改文件名。
- **素材 = `assets/` 子目录**：导出时与画布一起打包；引用外部素材库需先复制进项目。
- **项目列表只存元数据**：Pinia persist 写入全局 `settings.json` 的 `stores["xqwcanvas.projectList"]`（`project`、`projectList`、`lastCanvasIds`、`canvasLastUsedAt`），真实内容永远在用户文件夹里。
- **保存**：画布变更 500ms 防抖，`cn = cn.then(...)` 串行排队，`writeJson` 写整份 `{xqwCanvas,nodes,edges,viewport}`；后端写入统一走 `tmp 文件 + rename` 原子替换。
- **退出保护**：关闭前 `await` 保存；若 `saveBusy` 或保存失败，弹确认框“无法保存项目：…仍然退出将丢弃尚未保存的修改”，可选择“留在项目”。
- **无数据库、无云同步**：文件可被 Git/网盘/备份工具直接管理。

### 4.4 关键差异

| 维度 | 当前 infinite-canvas | XQWCanvas |
| --- | --- | --- |
| 数据形态 | IndexedDB 键值 / 应用数据目录下的私有结构 | 用户自选文件夹里的普通 `*.json` + `assets/` |
| 项目边界 | 应用内实体，磁盘目录由应用命名 | 用户目录，可直接打开/备份/搬迁 |
| 画布粒度 | 多画布（新源码），`canvases/<id>.json` | 多画布，每张一个文件名即画布名 |
| 媒体 | 独立 `media/`，靠 `storageKey` 引用 | 项目内 `assets/<节点ID>/...` |
| 写入 | 400ms 防抖 + 串行队列 + 原子写 | 500ms 防抖 + 串行链 + 原子写 |
| 关窗保护 | 无 | 有，且可阻止退出 |
| 失败反馈 | toast + `storageError` | 顶部保存状态 + 退出拦截 |
| 数据可发现性 | 低（藏在 IndexedDB/AppData） | 高（资源管理器可见） |
| 版本迁移 | 无 schema 版本、无迁移 | 文件内 `xqwCanvas` 标记 + 格式校验 |

## 5. 改造方案

### 方案 A：保留现有双后端，只补“落盘可靠性”（推荐）

**目标**：不推翻 Sidecar 与 localForage 结构，解决“看不到/丢最后一段/失败了没人管”。

1. **统一数据格式并修掉历史包袱**
   - 桌面端继续用现有多画布目录结构；`project.json` 只放元数据，画布独立文件。
   - 增加 `schemaVersion`（项目级 + 画布级），写入时带版本，读取时校验；不匹配直接显式报错，不做静默兜底。
2. **旧数据处理（按 AGENTS.md 不写运行时兼容）**
   - 提供一次性本地脚本（例如 `scripts/migrate-legacy-project.mjs`，仅在需要时手动运行）：把旧 `project.json` 里的 `nodes/connections/chatSessions/viewport` 拆成 `canvases/画布1.json` 并重建 `canvases/index.json`；跑完保留 `.bak`。
   - 或者对开发期数据直接删除重来。**不要**在运行时写“读到 nodes 就自动转换”的双格式分支。
3. **保存时机**
   - 保留 400ms 防抖；新增 `beforeunload` / `pagehide` 同步触发 `flushProject()`（浏览器），Tauri 端接 `onCloseRequested`，`await flushProject()` 成功后再 `destroy()`，失败弹确认。
   - 桌面端 `main.rs` 退出前给 Sidecar 一个优雅关闭窗口（先等待在途请求，再 kill）。
4. **失败可见与重试**
   - `persistCanvas` 失败后指数退避重试（有限次），并在顶部显示“未保存”状态。
   - 409 冲突：重新拉取最新 `revision` 后重试一次；仍失败则明确提示“另有窗口在写同一画布”，不静默丢弃。
   - 所有“未保存”状态在离页/关窗前必须显式提示。
5. **浏览器端一致性**
   - 项目列表的 read-modify-write 加单文件串行队列（复用 `projectAssetQueues` 的思路）。
   - `createStoredProject` 改为“先写项目与画布，最后写索引”，失败时清理半成品（当前已是这个顺序，补清理）。
   - 启动时调用 `navigator.storage.persist()` 申请持久化，降低被回收概率。
6. **备份与迁移**
   - 沿用现有 Zip 导出（`projects.json` + `files/`），在项目列表增加“导出全部项目”和一键备份入口；导入保持现有逻辑。
   - 「我的素材」补同样的导出/导入覆盖（当前只导出项目内资产）。
7. **文档**
   - 更新 `canvas-data-structure.zh-CN.mdx`：现在写的还是 `infinite-canvas:canvas_store` 单画布结构，与代码（`canvas_project_index` / `canvas_document:{projectId}:{canvasId}`）不一致。

**影响面**：`web/src/services/project-storage.ts`、`web/src/stores/canvas/use-canvas-store.ts`、`web/src/pages/canvas/project.tsx`、`web/src-tauri/src/main.rs`、`web/server/{desktop-server,storage-files}.mjs`、文档。约 6-8 个文件。
**风险**：低到中。不改节点模型、不动生成链路、不动协同。
**不能解决的**：浏览器模式下数据仍不可见于文件系统；换浏览器仍会“看不到”。

### 方案 B：整体对齐 XQW 的“文件化项目”

**做法**：项目 = 用户选择的文件夹；画布 = 目录内 `*.json`（带 `xqwCanvas` 标记）；素材 = `assets/`；项目列表只存路径元数据；桌面端通过 Sidecar 暴露文件树 API；浏览器端退化为 File System Access API 或仍用 IndexedDB。

**收益**：数据可发现、可 Git/网盘备份、跨设备迁移成本低；与 XQW 心智一致。
**影响面**：项目/画布模型、导入导出、媒体引用、协同房间标识、Agent 目标画布识别、素材清理、全部 UI 入口。约 20+ 文件。
**风险**：高。路径权限、盘符/目录被移动、文件被外部修改、多窗口并发写、浏览器端能力缺失都要处理；协同房间以什么作为稳定 ID 也需要重新设计。
**建议**：不要一次做完。若要推进，先做“桌面端可选的文件夹项目模式”，与现有 AppData 项目并存，稳定后再决定是否替换。

### 方案 C：只补提示与文档（不推荐，但成本最低）

只更新文档、在清缓存/关窗前提示“请先导出”。解决不了结构升级和数据不可见问题，只降低误解。

## 6. 落地顺序建议

1. 先做 R1 止血：确认发布版与源码一致，避免旧 `project.json` 被读成空画布；旧数据用一次性脚本拆分或明确丢弃。
2. 再做 R3 + R4：关窗 flush、失败重试与未保存提示。
3. 然后 R5 + R2：索引串行化、持久化申请、导出入口。
4. 最后评估是否进入方案 B。

## 7. 验收要点

- 新建项目 → 编辑 → 400ms 内直接关窗 → 重开内容完整。
- 桌面端正在保存时点关闭 → 应用等待保存完成再退出；失败时弹确认。
- 把 `storage` 目录中某张画布文件改坏 → 打开项目给出明确错误，而不是静默新建空画布。
- 浏览器端清空站点数据前，导出 Zip 能在桌面端/另一浏览器完整导入（含媒体）。
- Web 与桌面两端分别验证“项目列表 / 画布内容 / 我的素材 / 项目内素材”四项。
