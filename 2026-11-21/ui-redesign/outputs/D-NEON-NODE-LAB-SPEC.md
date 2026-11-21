# D · 霓虹节点实验室 — 落地方案

> 本轮只出方案与 mock，不改动项目代码。
> 设计稿：[D-canvas-light.png](../../outputs/D-canvas-light.png) · [D-canvas-dark.png](../../outputs/D-canvas-dark.png) · [源文件](../mockup-src/D-canvas.html)

---

## 0. 一句话定位

近黑底 + 单一霓虹强调色 + 玻璃 chrome，把「生成中」的状态变成画布上的一等公民。
它不是在现有暖灰体系上换颜色，而是**另一套色彩身份**：暗色是主场景，亮色是它的降饱和版本。

---

## 1. 与现有规范的三处冲突（必须先决定）

### 1.1 顶栏胶囊 vs AGENTS.md「极简扁平」

AGENTS.md 画布 UI 规范第 5 条要求顶栏与状态信息「无边框、无阴影、无胶囊背景，融入整体背景」。D 的悬浮胶囊顶栏直接与之冲突。

两个可选处理：

- **(a) 只破例顶栏**：仅画布顶栏允许悬浮胶囊，其余 chrome 保持扁平；同步在 AGENTS.md 该条后追加一句「仅画布顶栏允许悬浮胶囊容器」。（推荐，改动面最小）
- **(b) 顶栏也不胶囊化**：顶栏透明扁平，只保留 chipbar 承担霓虹身份。

底部工具条**不受影响**——现有 `canvas-toolbar.tsx` 已经是「无底色 + 仅 hover 反馈」的扁平写法，正好符合规范，本次不需要给它加玻璃胶囊外壳。

### 1.2 第二套色彩体系不能污染 antd 全局 token

霓虹强调色只进 `web/src/lib/canvas-theme.ts`（画布专属），`web/src/lib/app-theme.ts` 保持中立。顶栏里已有的 antd `Dropdown` / `Segmented` 弹层继续走 `app-theme.ts` 的弹层色，**不做霓虹化**——这既是 AGENTS.md 的硬要求，也避免弹层与节点抢视觉。

### 1.3 `backdrop-filter: blur()` vs 节点高频拖拽 60fps

AGENTS.md 要求拖拽/连线期间保障 60fps。`blur` 会强制开新的合成层，节点一多就是灾难。约束：

- blur **只允许**出现在 4 个固定 chrome 容器：顶栏、chipbar、底部工具条、左侧面板 / Agent 面板。
- 节点卡片一律用不透明底色 + 边框 + 阴影，**不用 blur**。

同理，连线发光**不能用 svg `filter: drop-shadow`**（对整层栅格化，连线一多直接掉帧），改为**双层描边**：

```
底层：同一条 path，stroke-width 4，opacity .18
上层：同一条 path，stroke-width 1.5，opacity .75
```

---

## 2. 新增 Token（唯一数据源：`web/src/lib/canvas-theme.ts`）

| key | dark | light | 用途 |
| --- | --- | --- | --- |
| `canvas.background` | `#06070a` | `#eef3fa` | 画布底 |
| `canvas.dot` | `rgba(110,175,255,.16)` | `rgba(10,60,140,.13)` | 网格点 |
| `accent` | `#38e1ff` | `#0f8fd4` | 选中、连线、主按钮 |
| `accentAlt` | `#ff4fd8` | `#b62ed0` | 参考类连线、镜像状态 |
| `accentSoft` | `rgba(56,225,255,.16)` | `rgba(15,143,212,.14)` | hover / active 填充 |
| `glow` | `rgba(56,225,255,.45)` | `rgba(15,143,212,.28)` | 选中与生成态的发光边框 |
| `chrome` | `rgba(16,19,26,.72)` | `rgba(255,255,255,.84)` | 玻璃 chrome 底色（配 blur） |
| `node.panel` | `#12161e` | `#ffffff` | 节点不透明底 |

注意：`accent` 是**状态色**，不是装饰底色。只在「选中 / 生成中 / 连线」出现，不得拿来当普通按钮填充——这与 AGENTS.md 对灰色 `activeBg` 的约束同源。

---

## 3. 组件改造清单

| 文件 | 现状 | 改成 | 备注 |
| --- | --- | --- | --- |
| `lib/canvas-theme.ts` | 无强调色 | 增加上表 8 个 key | 唯一 token 入口，先做 |
| `components/canvas/canvas-top-bar.tsx` | `absolute left-0 right-0 top-0 h-16` 全宽通栏 | 居中悬浮胶囊：`left-1/2 -translate-x-1/2 top-3.5 h-11 rounded-full` + `chrome` + `backdrop-blur-xl` | 内部 3 个 antd 控件与 `CanvasDocumentSwitcher`、`CanvasSaveStatus` 逻辑不动，只换外壳 |
| **新增** `components/canvas/canvas-status-chips.tsx` | 无 | chipbar 四枚胶囊 | 数据全部派生自 `useCanvasStore`，不新增 store |
| `components/canvas/canvas-toolbar.tsx` | 已是扁平无底色 | 不改 | 如需加强选中态，把 `activeStyle` 换成 `accentSoft + accent` |
| `components/canvas/canvas-node.tsx` | 圆角 14、`node.fill` 底、选中 `text.primary` 边框 | 圆角 16；选中 = `accent` 边框 + `0 0 0 1px accent` + `0 0 28px glow`；生成中 = 同款 glow（由 `metadata.status` 驱动） | 不用 blur |
| `components/canvas/canvas-connections.tsx` | 单层描边 `hairline.strong` | 双层描边；参考类连线用 `accentAlt` | 见 1.3 |
| `components/canvas/canvas-node-hover-toolbar.tsx` | 已有阴影浮层 | 圆角/描边跟随新 token | 结构不动 |
| `components/canvas/canvas-node-prompt-panel.tsx` | `surface.base` 面板 | `chrome` + blur + 圆角 16 | 唯一允许 blur 的节点相关浮层 |
| `components/canvas/canvas-side-panel.tsx` | 贴边 0 宽 280 实心 | 浮动卡片：左 16 / 上 60 / 下 16，圆角 16 + `hairline` + `shadow` + blur | |
| `components/agent/agent-panel.tsx` | 贴边实心 | 同上，右 16 / 上 60 / 下 16 | |
| `components/canvas/canvas-zoom-controls.tsx`、`canvas-mini-map.tsx` | 贴右下 | 右移避让 Agent 浮动面板；小地图配色换 `accent` | mock 里坐标是 `right:352 / bottom:84` |
| `styles/globals.css` | — | 只加少量 `--canvas-*` 变量 | 遵循 AGENTS.md：不堆组件私有样式 |

### chipbar 数据来源（已确认字段存在）

`web/src/types/canvas.ts` 的节点 `metadata` 已有 `status`、`progressPct`、`progressNodeStep`、`progressNodeSteps`、`seed`，因此：

- `GENERATING n%` ← 所有 `status === "running"` 节点 `progressPct` 的最大值
- `QUEUE n` ← `status` 处于排队态的节点计数
- `REF n / 9` ← 当前选中节点已连的参考图数量
- `SEED x` ← 当前选中节点 `metadata.seed`

**无生成任务、无选中节点时整条 chipbar 隐藏**，不留空壳。

---

## 4. 分阶段实施

| 阶段 | 内容 | 可独立验收 |
| --- | --- | --- |
| Phase 0 | `canvas-theme.ts` 增加 accent 组 + `globals.css` 变量 | 无视觉回归 |
| Phase 1 | 顶栏胶囊化 + 新增 chipbar | 用户感知最强，可单独发 |
| Phase 2 | 节点选中态 / 生成态霓虹化 + 连线双层描边 | |
| Phase 3 | 左侧面板、Agent、缩放 / 小地图浮动化与重排 | |
| Phase 4 | 亮色版单独调平（亮色不是暗色的反相） | |

---

## 5. 验收清单

- 顶栏胶囊在 1280 / 1600 / 1920 三档宽度下不换行、不与 chipbar 重叠。
- chipbar 四枚胶囊数值与实际生成状态一致；无任务时整条隐藏。
- 拖拽 50 个节点的帧率与改造前持平（性能面板对比，确认 blur 不在节点上）。
- 连线超过 60 条时无明显掉帧（双层描边已替代 `drop-shadow`）。
- 亮 / 暗切换后节点、连线、浮层颜色全部由 token 驱动，无硬编码 hex。
- antd `Dropdown` / `Menu` 弹层颜色仍走 `app-theme.ts`，未被霓虹污染。
- 亮色模式下 `accent` 对正文对比度 ≥ 4.5:1，对图形 ≥ 3:1。

---

## 6. 待你确认的决策

**AGENTS.md 画布 UI 规范第 5 条要求顶栏「无边框、无阴影、无胶囊背景」，与 D 的悬浮胶囊顶栏冲突。**

- **(a) 只破例顶栏**（推荐）：顶栏允许悬浮胶囊，其余 chrome 保持扁平，并在 AGENTS.md 该条后追加一句例外说明。
- **(b) 顶栏保持透明扁平**：只保留 chipbar 与节点/连线的霓虹身份，不引入任何胶囊容器。

其余部分（token、chipbar、节点与连线、面板浮动化）与现有规范不冲突，可直接按上表推进。
