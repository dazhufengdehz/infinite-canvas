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

document.body.style.fontFamily = '"SF Pro Display","SF Pro Text","PingFang SC","Microsoft YaHei","Helvetica Neue",sans-serif';

createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <AppProviders>
            <RouterProvider router={router} />
        </AppProviders>
    </React.StrictMode>,
);
