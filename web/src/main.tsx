import React from "react";
import { createRoot } from "react-dom/client";
import "antd/dist/reset.css";
import "streamdown/styles.css";
import "./styles/globals.css";
import { RouterProvider } from "react-router-dom";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";

import { AppProviders } from "@/components/layout/app-providers";
import "@/i18n";
import { initAnalytics } from "@/lib/analytics";
import { canvasPathFromDesktopDeepLink } from "@/lib/agent/agent-url-bootstrap";
import { router } from "@/router";
import { discoverAgentConfig } from "@/services/api/canvas-agent";
import { useAgentStore } from "@/stores/use-agent-store";

initAnalytics();

let previousDeepLink = "";
let previousDeepLinkTime = 0;
function handleDesktopDeepLinks(urls: string[]) {
    urls.forEach((url) => {
        const target = canvasPathFromDesktopDeepLink(url);
        if (!target) return;
        const now = Date.now();
        if (target === previousDeepLink && now - previousDeepLinkTime < 1000) return;
        previousDeepLink = target;
        previousDeepLinkTime = now;
        void router.navigate(target);
    });
}

async function listenDesktopDeepLinks() {
    if (!("__TAURI_INTERNALS__" in window)) return;
    await onOpenUrl(handleDesktopDeepLinks);
    handleDesktopDeepLinks((await getCurrent()) || []);
}
void listenDesktopDeepLinks().catch((error) => console.error("桌面链接处理失败", error));

async function connectDesktopAgent() {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const { invoke } = await import("@tauri-apps/api/core");
    for (let attempt = 0; attempt < 40; attempt += 1) {
        const config = await invoke<{ url?: string; token?: string } | null>("get_canvas_agent_config");
        const url = config?.url?.trim().replace(/\/$/, "");
        const token = config?.token?.trim();
        if (url && token) {
            useAgentStore.setState({ url, token });
            if (await discoverAgentConfig(url)) {
                await useAgentStore.getState().connectAgent({ silent: true });
                return;
            }
        }
        await new Promise((resolve) => window.setTimeout(resolve, 250));
    }
    throw new Error("桌面 Agent 服务启动超时");
}
void connectDesktopAgent().catch((error) => console.error("桌面 Agent 自动连接失败", error));

createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <AppProviders>
            <RouterProvider router={router} />
        </AppProviders>
    </React.StrictMode>,
);
