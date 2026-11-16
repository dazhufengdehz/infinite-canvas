import { describe, expect, it } from "vitest";

import { canvasPathFromDesktopDeepLink } from "./agent-url-bootstrap";

describe("canvasPathFromDesktopDeepLink", () => {
    it.each(["new", "recent", "choose"])("保留 %s 模式和 Agent 连接凭据", (mode) => {
        const hash = "#agentUrl=http%3A%2F%2F127.0.0.1%3A17371&agentToken=test-token";
        expect(canvasPathFromDesktopDeepLink(`infinite-canvas://canvas?mode=${mode}${hash}`)).toBe(`/canvas?mode=${mode}${hash}`);
    });

    it("忽略非画布协议、错误主机和无效链接", () => {
        expect(canvasPathFromDesktopDeepLink("https://canvas.imihoo.com/canvas?mode=new")).toBeNull();
        expect(canvasPathFromDesktopDeepLink("infinite-canvas://other?mode=new")).toBeNull();
        expect(canvasPathFromDesktopDeepLink("not a url")).toBeNull();
    });

    it("无效模式不触发自动新建", () => {
        expect(canvasPathFromDesktopDeepLink("infinite-canvas://canvas?mode=unexpected#agentToken=test-token")).toBe("/canvas#agentToken=test-token");
    });
});
