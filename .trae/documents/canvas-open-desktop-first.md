# Context

`canvas_open` 当前在 `canvas-agent/src/utils/browser.ts` 中固定构造线上画布 URL 并调用系统浏览器，因此 MCP 连接正常也会每次打开网页。用户已确认希望默认优先唤起已安装的桌面客户端；未安装时明确提示，显式传入 `url` 时仍允许打开指定网页。

# 实现方案

1. **为桌面端注册协议并保证单实例**
   - 在 `web/src-tauri/Cargo.toml` 加入 Tauri 2 的 `deep-link`、`single-instance` 插件，在 `web/package.json` 加入 `@tauri-apps/plugin-deep-link`。
   - 在 `web/src-tauri/tauri.conf.json` 注册 `infinite-canvas://` 协议，在 `capabilities/default.json` 补充所需权限。
   - 在 `web/src-tauri/src/main.rs` 最先启用单实例：重复唤起时显示、还原并聚焦主窗口，避免重复启动 Sidecar；随后启用 deep-link。

2. **统一处理冷启动与运行中唤起**
   - 桌面链接采用 `infinite-canvas://canvas?mode=new|recent|choose#agentUrl=...&agentToken=...`。
   - 在 `web/src/lib/agent/agent-url-bootstrap.ts` 增加纯转换函数，把桌面链接转换为现有 `/canvas?...#...` 路由，不复制 Agent 连接逻辑。
   - 在 `web/src/main.tsx` 同时处理插件 `getCurrent()` 与 `onOpenUrl()`，用现有 `router.navigate()` 跳转并按完整 URL 去重。这样 `CanvasProject` 继续处理三种 mode，`LocalAgentPanel` 继续通过 `readAgentUrlBootstrap` 清除凭据并自动连接；避免 StrictMode 或冷/热事件重复导致重复新建项目。

3. **让 MCP 默认走桌面**
   - 将 `canvas-agent/src/utils/browser.ts` 的浏览器专用入口调整为统一 `openCanvas`：无 `url` 时生成桌面深链，Windows 先检查协议注册，未安装返回明确安装提示且不静默回退网页；显式 `url` 时沿用原网页构造和浏览器行为。
   - 同步 `canvas-agent/src/canvas/session.ts` 与 `server/mcp.ts`。MCP 对 `canvas_open` 直接执行当前包实现，避免仍在运行的旧 HTTP Agent 进程继续打开网页。
   - 更新 `canvas-agent/src/canvas/schemas.ts` 的 `canvas_open` 描述，并把“当前网页画布/没有已连接网页”等相关工具文案改为同时适用于桌面与网页的表述。

4. **测试、文档与实际使用**
   - 为深链转换、默认桌面、显式网页和未安装提示补充针对测试，复用 `agent-url-bootstrap.test.ts` 等现有测试风格；执行 Canvas Agent、前端相关测试及桌面构建。
   - 更新 `canvas-agent/README.md`、WorkBuddy 连接说明、`CHANGELOG.md` 和双语 `pending-test`；如 `todo` 无对应事项则不新增无关待办。
   - 验收时将当前 Trae MCP 启动命令临时指向本项目 `canvas-agent/dist/index.js` 并重启该 MCP，避免 `npx` 缓存继续运行旧包；不擅自发布 npm。最终重新生成包含协议注册的 NSIS 安装包。
   - 按项目规则清理临时产物并创建详细中文 Git commit，不包含 `.trae/`。

# 验证

- 未安装桌面端时，默认 `canvas_open` 返回明确未安装提示；显式 `url` 仍能打开网页。
- 安装新 NSIS 后，冷启动调用 `canvas_open(mode=recent)`：只出现一个客户端和一个 Sidecar，自动连接本地 Agent，MCP 能读取画布状态。
- 客户端已运行且最小化时再次调用：原窗口还原聚焦，不重复新建项目、不启动第二个 Sidecar。
- 分别验证 `new`、`recent`、`choose`，确认 `new` 不因重复事件创建两个项目。
- 验证工具描述及“未连接画布”提示不再把桌面端误称为网页。
