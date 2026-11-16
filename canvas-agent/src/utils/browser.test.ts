import assert from "node:assert/strict";
import test from "node:test";

import { openCanvas } from "./browser.js";

const config = { url: "http://127.0.0.1:17371", token: "test-token" };
const credentials = "agentUrl=http%3A%2F%2F127.0.0.1%3A17371&agentToken=test-token";

test("canvas_open defaults to the desktop deep link", () => {
    let openedUrl = "";
    const result = openCanvas({ mode: "recent" }, {
        config,
        platform: "win32",
        desktopInstalled: true,
        openUrl: (url) => {
            openedUrl = url;
            return true;
        },
    });
    assert.equal(result.ok, true);
    assert.equal(result.target, "desktop");
    assert.equal(openedUrl, `infinite-canvas://canvas?mode=recent#${credentials}`);
});

test("canvas_open uses the browser only for an explicit url", () => {
    let openedUrl = "";
    const result = openCanvas({ mode: "choose", url: "https://canvas.example.test/" }, {
        config,
        platform: "win32",
        desktopInstalled: false,
        openUrl: (url) => {
            openedUrl = url;
            return true;
        },
    });
    assert.equal(result.ok, true);
    assert.equal(result.target, "web");
    assert.equal(openedUrl, `https://canvas.example.test/canvas?mode=choose#${credentials}`);
});

test("canvas_open reports a missing desktop client without web fallback", () => {
    let openCalled = false;
    const result = openCanvas({ mode: "new" }, {
        config,
        platform: "win32",
        desktopInstalled: false,
        openUrl: () => {
            openCalled = true;
            return true;
        },
    });
    assert.equal(result.ok, false);
    assert.equal(result.target, "desktop");
    assert.equal(openCalled, false);
    assert.match(result.message, /未检测到 Infinite Canvas 桌面客户端/);
    assert.match(result.message, /显式传入 url/);
});
