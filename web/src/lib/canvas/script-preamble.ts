const GLOBAL_KEY = "infinite-canvas:script-preamble";
const projectKey = (projectId: string) => `infinite-canvas:script-preamble:${projectId}`;

export function readGlobalScriptPreamble() {
    try {
        return localStorage.getItem(GLOBAL_KEY) || "";
    } catch {
        return "";
    }
}

export function writeGlobalScriptPreamble(value: string) {
    try {
        if (value.trim()) localStorage.setItem(GLOBAL_KEY, value);
        else localStorage.removeItem(GLOBAL_KEY);
    } catch {
        // 本地存储不可用时忽略
    }
}

export function readProjectScriptPreamble(projectId: string) {
    if (!projectId) return "";
    try {
        return localStorage.getItem(projectKey(projectId)) || "";
    } catch {
        return "";
    }
}

export function writeProjectScriptPreamble(projectId: string, value: string) {
    if (!projectId) return;
    try {
        if (value.trim()) localStorage.setItem(projectKey(projectId), value);
        else localStorage.removeItem(projectKey(projectId));
    } catch {
        // 本地存储不可用时忽略
    }
}
