export function canvasPathFromDesktopDeepLink(value: string) {
    try {
        const url = new URL(value);
        if (url.protocol !== "infinite-canvas:" || url.hostname !== "canvas") return null;
        const mode = url.searchParams.get("mode");
        const query = mode === "new" || mode === "recent" || mode === "choose" ? `?mode=${mode}` : "";
        return `/canvas${query}${url.hash}`;
    } catch {
        return null;
    }
}

export function hasAgentUrlBootstrap(hash: string) {
    const params = new URLSearchParams(hash.replace(/^#/, ""));
    return params.has("agentUrl") || params.has("agentToken");
}

export function readAgentUrlBootstrap(hash: string) {
    const params = new URLSearchParams(hash.replace(/^#/, ""));
    if (!params.has("agentUrl") && !params.has("agentToken")) return null;
    const url = params.get("agentUrl")?.trim() || "";
    const token = params.get("agentToken")?.trim() || "";
    params.delete("agentUrl");
    params.delete("agentToken");
    const remaining = params.toString();
    return { url, token, remainingHash: remaining ? `#${remaining}` : "" };
}
