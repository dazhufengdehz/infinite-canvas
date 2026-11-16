import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

import { loadConfig, type CanvasAgentConfig } from "../config.js";

type CanvasOpenOptions = { mode?: "new" | "recent" | "choose"; url?: string };
type OpenCanvasOverrides = {
    config?: CanvasAgentConfig;
    platform?: NodeJS.Platform;
    desktopInstalled?: boolean;
    openUrl?: (url: string) => boolean;
};

function registeredDesktopExecutable() {
    try {
        const command = "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); (Get-ItemProperty -LiteralPath 'Registry::HKEY_CLASSES_ROOT\\infinite-canvas\\shell\\open\\command' -ErrorAction Stop).'(default)'";
        const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { encoding: "utf8", windowsHide: true });
        if (result.status !== 0) return "";
        const executable = result.stdout.trim().match(/^"([^"]+)"\s+"%1"$/)?.[1] || "";
        return executable && existsSync(executable) ? executable : "";
    } catch {
        return "";
    }
}

/** 通过系统 URL 处理器打开浏览器链接或桌面深链。 */
function openUrl(targetUrl: string, platform: NodeJS.Platform) {
    try {
        if (platform === "darwin") {
            spawn("open", [targetUrl], { detached: true, stdio: "ignore" }).unref();
        } else if (platform === "win32" && targetUrl.startsWith("infinite-canvas://")) {
            const executable = registeredDesktopExecutable();
            if (!executable) return false;
            spawn(executable, [targetUrl], { detached: true, stdio: "ignore", windowsHide: true }).unref();
        } else if (platform === "win32") {
            spawn("cmd.exe", ["/c", "start", '""', targetUrl], { detached: true, stdio: "ignore", windowsHide: true }).unref();
        } else {
            spawn("xdg-open", [targetUrl], { detached: true, stdio: "ignore" }).unref();
        }
        return true;
    } catch {
        return false;
    }
}

function isDesktopCanvasInstalled() {
    return Boolean(registeredDesktopExecutable());
}

/** 默认唤起桌面客户端；显式传入 url 时打开网页画布。 */
export function openCanvas(options: CanvasOpenOptions = {}, overrides: OpenCanvasOverrides = {}) {
    const config = overrides.config || loadConfig(true);
    const platform = overrides.platform || process.platform;
    const mode = options.mode || "new";
    const credentials = `agentUrl=${encodeURIComponent(config.url)}&agentToken=${encodeURIComponent(config.token)}`;
    const webBase = options.url?.trim();
    const target = webBase ? "web" : "desktop";
    const targetUrl = webBase
        ? `${webBase.replace(/\/+$/, "")}/canvas?mode=${encodeURIComponent(mode)}#${credentials}`
        : `infinite-canvas://canvas?mode=${encodeURIComponent(mode)}#${credentials}`;

    if (target === "desktop" && platform === "win32" && !(overrides.desktopInstalled ?? isDesktopCanvasInstalled())) {
        return {
            ok: false,
            url: targetUrl,
            mode,
            target,
            message: "未检测到 Infinite Canvas 桌面客户端。请先安装支持 infinite-canvas:// 协议的最新版桌面客户端；如需打开网页版，请显式传入 url。",
        };
    }

    const opened = (overrides.openUrl || ((url: string) => openUrl(url, platform)))(targetUrl);
    return {
        ok: opened,
        url: targetUrl,
        mode,
        target,
        message: opened
            ? target === "desktop" ? `已唤起 Infinite Canvas 桌面客户端（模式：${mode}）` : `已在系统浏览器中打开 Infinite Canvas 画布（模式：${mode}）`
            : target === "desktop" ? "唤起桌面客户端失败，请确认已安装最新版 Infinite Canvas" : "打开浏览器失败，请手动访问链接",
    };
}
