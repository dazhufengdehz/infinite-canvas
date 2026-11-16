const configuredBaseUrl = (import.meta.env.VITE_STORAGE_SERVER_URL || "").replace(/\/$/, "");
let healthPromise: Promise<boolean> | null = null;

export class StorageApiError extends Error {
    constructor(message: string, readonly status: number) {
        super(message);
        this.name = "StorageApiError";
    }
}

export function storageApiUrl(path: string) {
    return `${configuredBaseUrl}/api/storage${path}`;
}

async function probeStorageServer() {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 1500);
    try {
        const response = await fetch(`${configuredBaseUrl}/api/health`, { signal: controller.signal });
        const data = await response.json();
        return response.ok && data?.ok === true;
    } catch {
        return false;
    } finally {
        window.clearTimeout(timer);
    }
}

export async function hasStorageServer() {
    if (!healthPromise) {
        healthPromise = (async () => {
            for (let attempt = 0; attempt < (configuredBaseUrl ? 20 : 1); attempt++) {
                if (await probeStorageServer()) return true;
                if (configuredBaseUrl) await new Promise((resolve) => window.setTimeout(resolve, 100));
            }
            if (configuredBaseUrl) throw new Error("本地磁盘存储服务连接失败，请重启桌面应用");
            return false;
        })();
    }
    return healthPromise;
}

export async function storageRequest<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(storageApiUrl(path), init);
    const contentType = response.headers.get("content-type") || "";
    const data = contentType.includes("application/json") ? await response.json() : null;
    if (!response.ok) throw new StorageApiError(data?.error || `存储请求失败（${response.status}）`, response.status);
    return data as T;
}

export function storageMediaUrl(storageKey: string) {
    return storageApiUrl(`/media/${encodeURIComponent(storageKey)}`);
}

export function candidatePosterUrl(candidateId: string) {
    return storageApiUrl(`/candidate-posters/${encodeURIComponent(candidateId)}`);
}

export async function putStorageBlob(path: string, blob: Blob) {
    await storageRequest(path, {
        method: "PUT",
        headers: { "Content-Type": blob.type || "application/octet-stream" },
        body: blob,
    });
}
