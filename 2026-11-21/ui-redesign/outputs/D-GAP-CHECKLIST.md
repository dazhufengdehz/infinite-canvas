# D · 霓虹节点实验室 — 与现状差异 & 改造清单

## 0. 结论先说

当前画布**不像 D 稿**，根因不是执行走样，而是 `D-NEON-NODE-LAB-SPEC.md` 本身做了取舍：它把 D 定义为「**在现有信息架构上套 D 的视觉语言**」，只要求换 token + 换容器外壳 + 节点/连线状态色，**没有要求重做信息架构**。而 D 稿（`mockup-src/D-canvas.html`）恰恰是**重做了信息架构**：

- 顶栏 → 居中单胶囊，功能大幅收进二级入口
- 左侧 280 横向 Tab 面板 → 54px 竖向图标 rail
- 节点标题在卡片内 → 卡片**外上方**一条 mono 大写 label
- 底部工具栏透明扁平 → 居中悬浮胶囊 + 圆形按钮
- 连线实线 → 青色虚线 + 端点圆点

本清单把「要像 D 稿」所需改动逐项拆开，标注现状位置、mock 的具体数值、改动要点与风险。

---

## 1. 差异总表

| 项 | D 稿 | 现状 | 差距 |
|---|---|---|---|
| 顶栏 | 居中单胶囊 `left:50% translateX(-50%) width:max-content h:46 r:999px`，仅 返回/标题/文档/8188/分享/面板/头像 | 左右两枚胶囊，承载 12+ 个常驻控件 | **IA 级** |
| 左侧面板 | 竖向图标 rail `left:16 top:76 w:54 r:16 blur(18px)`，7 个图标 | 280px 横向 Tab 面板（canvas/assets/prompts） | **IA 级** |
| 节点标题 | 卡片**外上方** mono 9.5px 大写 + `letter-spacing:.14em`，类型用 `--neon` | 已有「卡片上方」结构，但 text-xs 常规字体、仅 hover/选中/编辑时显示 | 样式级 |
| 节点卡片 | `r:16` + `background:var(--node)`(半透明) + `blur(18px)` + 两档发光 | `r:16` 已达标，底为不透明 `node.fill` | 样式级（blur 不建议跟） |
| 连接点 | `10×10`，`r:3px` 小方块，青边 + `0 0 8px rgba(neon,.5)` | `size-6.5`(26px) 圆形，`node.panel` 底 | 样式级 |
| 连线 | 青色虚线 `dasharray:7 7` + `drop-shadow` + 端点 `circle r:4` | 实线双层描边（规格的性能取舍），无端点 | 样式级 |
| 底部工具栏 | 居中悬浮胶囊 `bottom:20 h:46 r:999px blur(18px)`，按钮 34px `r:50%`，active `rgba(neon,.18)` | `bottom-5` 居中，**透明无底无边**，antd 方形按钮，active 灰底 | **容器级** |
| 缩放控件 | `right:20 bottom:84`，小地图/适配/缩小/百分比/放大 | 小地图开关/复位/滑杆/百分比/快捷键 | 内容不同 |
| chipbar | `top:76 left:86`，英文大写 mono `GENERATING 62%` | `top:68 left:12`，中文「生成中 62%」 | 位置 + 文案 |
| Agent 面板 | `right:16 top:76 bottom:16 w:320 blur(20px)`，发送按钮 `var(--neon)` | `top-14 right-12 bottom-12`，宽度跟 store | 尺寸级 |
| 提示词面板 | 独立浮层：模型行 / 参考缩略图行 / textarea / 工具行 + 青色「停止」 | 节点内嵌面板，内部结构完全不同 | **结构级** |
| 亮色 | 有单独调平的亮色版 | Phase 4 未做（亮色 token 已改，细节未调平） | 待补 |
| 字体 | label/chip/数值统一 `Cascadia Mono` + 大写 | 无 mono 使用 | 样式级 |

---

## 2. 逐项改造清单

### A. 顶栏 → 居中单胶囊　【IA 级 / 需产品决策】

- 现状：`web/src/components/canvas/canvas-top-bar.tsx:94-229`
  - 左组：返回 / 面板开关 / 菜单(含 撤销·重做·导入·导出·新建·删除) / 标题 / 文档切换 / 保存 / 剧本 / 视图 Segmented / Agent 状态
  - 右组：ComfyUI 监控 / 协作 / 用户状态 / 主题 / 插件 / 快捷键 / Agent
- mock 数值（`mock.css:462,463`）：`left:50%; transform:translateX(-50%); width:max-content; height:46px; padding:0 12px; gap:8px; border-radius:999px; background:var(--surface); border:1px solid var(--line); box-shadow:var(--shadow); backdrop-filter:blur(18px)`；`.title { font-size:14px }`
- 改动要点：
  1. 外层合并为**一个** `rounded-full` 胶囊，`absolute left-1/2 -translate-x-1/2`。
  2. 「菜单」Dropdown 吸收：保存、剧本、视图 Segmented、撤销/重做、导入/导出。
  3. 新增 **8188 live chip**（复用 `canvas-comfyui-monitor.tsx` 的连接状态，mock 为 `.live > .dot`）。
  4. 新增**头像按钮**（mock `.avatar`），承载 用户状态 / 主题 / 插件 / 快捷键 / 协作。
- 风险：常驻入口从 12+ 降到 ~7，用户需要点两次才能触达。**这是产品决策，不是视觉决策。**

### B. 左侧面板 → 竖向图标 rail　【IA 级】

- 现状：`web/src/components/canvas/canvas-side-panel.tsx:104-106` 三个文字 Tab（`canvas` / `assets` / `prompts`），宽 280 可拖拽（`resize handle`）。
- mock 数值（`mock.css:464,465,466`）：`left:16; top:76; width:54; padding:12px 0; gap:6px; border-radius:16px;` 按钮 `38×38 r:10`；active `background:var(--hover); color:var(--neon)`。
- 两个可选方案：
  - **B1（推荐）**：保留现有面板内容与宽度，改成「54px rail 常驻 + 展开面板」双栏；rail 图标 6 个 = 画布 / 素材 / 提示词 / 分镜 / Agent /（底部）主题 / 设置。
  - **B2（低成本）**：只把顶部 Tab 文字换成图标，宽度与结构不变。
- 影响：rail 常驻会占左上角，chipbar 需按 mock 移到 `left:86`。

### C. 节点标题 → mono 大写 label　【性价比最高】

- 现状：`web/src/components/canvas/canvas-node.tsx:351-394` **已有**「卡片上方浮出标题」结构，`absolute left-3 bottom-full`，`text-xs font-medium`，颜色 `theme.node.text`，仅 `isSelected || hovered || isEditingTitle` 时渲染。
- mock 数值（`mock.css:472,473`）：`font-family:"Cascadia Mono",Consolas,monospace; font-size:9.5px; letter-spacing:.14em; text-transform:uppercase; bottom:calc(100% + 8px); color:var(--neon)`，其中 `<b>` 用 `var(--text-2)`。
- 改动要点：
  1. 文案格式改为 `IMAGE · 角色参考`：类型英文**大写** + `·` + 中文标题。中文无大写概念，`text-transform` 只作用于类型词。
  2. 类型部分着 `theme.accent.base`，标题部分着 `theme.text.secondary`。
  3. 字体 `font-mono`（`globals.css` 已有 `--font-mono: ui-monospace, "Cascadia Mono", ...`）+ `text-[9.5px] tracking-[.14em]`。
  4. **是否常显**需确认：mock 常显；现状仅 hover/选中显示。

### D. 连接点 → 10px 小方块　【有可用性风险】

- 现状：`web/src/components/canvas/canvas-node.tsx:1251-1290`，`size-6.5 rounded-full border shadow-sm`，背景 `theme.node.panel`。
- mock 数值（`mock.css:477`）：`width:10px; height:10px; border-radius:3px; background:var(--surface); border:1px solid var(--neon); box-shadow:0 0 8px rgba(neon,.5)`。
- 改动要点：视觉层改 `size-2.5` + `rounded-[3px]` + 边框 `theme.accent.base` + `0 0 8px theme.accent.glow`。
- 风险：现有 26px 触点 + 磁吸跟随 + 拖拽阈值是为了好点中；直接缩到 10px 会明显降低可点击性。**建议：外层热区保持 26px 不变，只缩小内层视觉块。**

### E. 连线 → 虚线 + 端点　【低风险】

- 现状：`web/src/components/canvas/canvas-connections.tsx` 双层实线描边（halo + main），`strokeDasharray` 仅 `invalid` 用 `"6,4"`。
- mock 数值（`mock.css:478,479,481`）：`stroke-width:1.5; stroke-dasharray:7 7; stroke:rgba(neon,.55)`；`.alt` 品红；端点 `circle r:4`。
- 改动要点：给常规连线加 `strokeDasharray="7 7"`；端点圆点可由 D 项的 handle 表达。
- **不跟**：`filter: drop-shadow(...)`（规格已明确为 60fps 取舍）。

### F. 底部工具栏 → 居中悬浮胶囊　【需放宽 AGENTS 条目】

- 现状：`web/src/components/canvas/canvas-toolbar.tsx:95-197`，`absolute bottom-5` 居中、**透明无底无边**、antd text Button 32×32、active 用 `theme.surface.active`（灰）。
- mock 数值（`mock.css:468,469,470`）：`bottom:20; height:46px; padding:0 10px; gap:2px; border-radius:999px; background:var(--surface); border:1px solid var(--line); box-shadow:var(--shadow); backdrop-filter:blur(18px)`；按钮 `34×34 r:50%`；active `background:rgba(neon,.18); color:var(--neon)`。
- 改动要点：外层加胶囊外壳（`accent.chrome` + `hairline.base` + `shadow-float` + `backdrop-blur-xl`）；按钮 `!rounded-full`；active 改 `accent.soft` 底 + `accent.base` 图标；分组 `Divider` 保留。
- **冲突**：`AGENTS.md` 规定「画布顶部工具栏和状态信息优先采用极简扁平风格：无边框、无阴影、无胶囊背景」及「画布内操作按钮默认扁平无底色」。此前只放宽了「顶栏」那条，本条需你确认是否一并放宽。

### G. 缩放控件　【内容差异 / 不建议跟】

- 现状：`web/src/components/canvas/canvas-zoom-controls.tsx` = 小地图开关 / 复位 / 缩放滑杆 / 百分比 / 快捷键。已做 Agent 面板避让偏移。
- mock 数值（`mock.css:471`）：`right:20; bottom:84`，内容 = 小地图 / 适配 / 缩小 / 百分比 / 放大。
- 建议：**保留现有功能**（滑杆与快捷键入口是真实功能），只统一容器样式与位置。

### H. chipbar　【文案有冲突】

- 现状：`web/src/components/canvas/canvas-status-chips.tsx`，`top-[68px] left-3`，中文「生成中 62% / 排队 2 / 参考 2 / 9 / 种子 118042」。
- mock 数值（`mock.css:484,485,486`）：`top:76; left:86; gap:6; height:26px; padding:0 11px; border-radius:999px; backdrop-filter:blur(14px)`；`on` 态 `color:var(--neon); border-color:rgba(neon,.5)`。
- 改动要点：等 B 项 rail 落地后位置改 `top-[76px] left-[86px]`。
- **冲突**：mock 用英文大写 mono（`GENERATING 62%`），`AGENTS.md` 要求「页面文案保持中文」。需你选：中文 / 英文 mono / 中英混排。

### I. Agent 面板　【尺寸级】

- 现状：`web/src/components/agent/agent-panel.tsx`，`absolute top-14 right-0 bottom-0` + `py-3 pr-3`，宽度跟 `use-agent-store`。
- mock 数值（`mock.css:467,487`）：`right:16; top:76; bottom:16; width:320; border-radius:16; backdrop-filter:blur(20px)`；发送按钮 `background:var(--neon)`。
- 改动要点：`top` 改 76（与 chipbar / rail 对齐，避开居中顶栏）；发送按钮底色霓虹化。
- 注意：发送按钮走 antd，`AGENTS.md` 要求不要在业务组件里为单个组件覆盖 antd token → 建议只做局部 style，不动全局。

### J. 提示词面板　【结构级 / 建议不做】

- 现状：`web/src/components/canvas/canvas-node-prompt-panel.tsx`（已 chrome + blur + 圆角 16）。
- mock（`D-canvas.html:154-174`）：模型选择行 → 参考缩略图行（含 `+` 与 `2 / 9 REF`）→ textarea → 工具行（参考 / 提示词库 + 青色「停止」）。
- 建议：内部结构与项目现有生成参数体系绑定，重排成本高、收益低，**不改**。

### K. 亮色版（原 Phase 4）　【待补】

- mock light（`mock.css:442-450`）：`--bg:#eef3fa; --surface:rgba(255,255,255,.84); --line:rgba(10,40,90,.12); --node:rgba(255,255,255,.72); --neon:#0f8fd4; --neon2:#b62ed0`。
- 现状：`web/src/lib/canvas-theme.ts` 的 `light` 已按这组值改 `canvas/node/accent`。剩余：连线、chipbar、工具栏在亮色下的对比度需实测调平。
- 验收：`D-canvas-light.png` 逐项比对。

### L. 字体

- `globals.css` 已有 `--font-mono: ui-monospace, "Cascadia Mono", "SF Mono", Consolas, monospace`，Tailwind `font-mono` 可直接用，无需新增。

---

## 3. 需要你决策的 4 个点

1. **顶栏收进二级菜单**：常驻入口会从 12+ 降到 ~7，是否接受？（决定 A 项做不做）
2. **节点标题是否常显**：mock 常显，现状仅 hover/选中显示。常显会提高画布信息密度。
3. **chipbar / 节点 label 文案**：mock 是英文大写 mono，`AGENTS.md` 要求中文。选：全中文 / 英文 mono / 类型英文+标题中文。
4. **底部工具栏加胶囊底**：需一并放宽 `AGENTS.md`「画布内操作按钮默认扁平无底色」这条。

---

## 4. 不建议照搬 mock 的地方

| mock 做法 | 原因 |
|---|---|
| 连线 `filter: drop-shadow(0 0 4px ...)` | svg 整层滤镜在多连线时直接掉帧，规格已用双层描边替代 |
| 节点卡片 `backdrop-filter: blur(18px)` + 半透明底 | 节点数量多，逐个模糊代价高；建议用低透明纯色替代 |
| 顶栏 / 工具栏 / 面板都用同一个 `--surface` | 层叠语义单一，浮层与浮层之间无法区分层级；项目已有 `chrome` / `surface` / `panel` 分层，保留项目分法 |

---

## 5. 建议实施顺序

**第一批（低风险、高辨识度）**：C 节点 label → D 触点视觉 → E 连线虚线 → F 工具栏胶囊化 → A 顶栏居中单胶囊
**第二批（中风险）**：B 侧栏 rail → I Agent 面板尺寸 + 发送按钮 → H chipbar 位置
**第三批**：K 亮色调平（对齐 `D-canvas-light.png`）
**不做**：J 提示词面板重排、G 缩放控件瘦身

每批完成后按 `outputs/D-canvas-dark.png` / `D-canvas-light.png` 逐项比对验收。
