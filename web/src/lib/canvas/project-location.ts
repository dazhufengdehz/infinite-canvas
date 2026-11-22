const LAST_PROJECT_DIR_KEY = "infinite-canvas:last-project-dir";

export function readLastProjectDir() {
    try {
        return window.localStorage.getItem(LAST_PROJECT_DIR_KEY) || undefined;
    } catch {
        return undefined;
    }
}

export function rememberProjectDir(dir: string) {
    try {
        window.localStorage.setItem(LAST_PROJECT_DIR_KEY, dir);
    } catch {}
}
