import localforage from "localforage";

import { hasStorageServer, putStorageBlob, storageMediaUrl, storageRequest } from "@/services/api/storage";
import { scopedStorageKey } from "@/services/project-storage";

export type UploadedFile = { url: string; storageKey: string; bytes: number; mimeType: string; width?: number; height?: number; durationMs?: number; posterUrl?: string; posterStorageKey?: string };

const store = localforage.createInstance({ name: "infinite-canvas", storeName: "media_files" });
const objectUrls = new Map<string, string>();
type MediaLease = { url: string; refs: number; owned: boolean; pending?: Promise<string> };
const leases = new Map<string, MediaLease>();

export async function uploadMediaFile(input: string | Blob, prefix = "file", ownerId = "assets"): Promise<UploadedFile> {
    const blob = typeof input === "string" ? await (await fetch(input)).blob() : input;
    const storageKey = scopedStorageKey(prefix, ownerId);
    const url = await setMediaBlob(storageKey, blob);
    const meta = blob.type.startsWith("video/") ? await readVideoMeta(url) : blob.type.startsWith("audio/") ? await readAudioMeta(url) : {};
    let posterUrl: string | undefined;
    let posterStorageKey: string | undefined;
    if ("poster" in meta && meta.poster) {
        posterStorageKey = storageKey.replace(/^[^:]+:/, "poster:");
        posterUrl = await setMediaBlob(posterStorageKey, meta.poster);
    }
    return { url, storageKey, bytes: blob.size, mimeType: blob.type || "application/octet-stream", ...meta, posterUrl, posterStorageKey };
}

export async function adoptMediaFile(source: { url: string; token?: string; mimeType?: string }, prefix: "video" | "audio", ownerId = "assets"): Promise<UploadedFile> {
    if (!(await hasStorageServer())) return uploadMediaFile(source.url, prefix, ownerId);
    const storageKey = scopedStorageKey(prefix, ownerId);
    await storageRequest("/media/adopt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetStorageKey: storageKey, sourceUrl: source.url, token: source.token, mimeType: source.mimeType }),
    });
    const url = storageMediaUrl(storageKey);
    const meta = prefix === "video" ? await readVideoMeta(url) : await readAudioMeta(url);
    let posterUrl: string | undefined;
    let posterStorageKey: string | undefined;
    if ("poster" in meta && meta.poster) {
        posterStorageKey = storageKey.replace(/^[^:]+:/, "poster:");
        posterUrl = await setMediaBlob(posterStorageKey, meta.poster);
    }
    return { url, storageKey, bytes: 0, mimeType: source.mimeType || (prefix === "video" ? "video/mp4" : "audio/mpeg"), ...meta, posterUrl, posterStorageKey };
}

export async function resolveMediaUrl(storageKey?: string, fallback = "") {
    if (!storageKey) return fallback;
    if (await hasStorageServer()) return storageMediaUrl(storageKey);
    const cached = objectUrls.get(storageKey);
    if (cached) return cached;
    const blob = await store.getItem<Blob>(storageKey);
    if (!blob) return fallback;
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    return url;
}

export async function getMediaBlob(storageKey: string) {
    if (await hasStorageServer()) {
        const response = await fetch(storageMediaUrl(storageKey));
        return response.ok ? response.blob() : null;
    }
    return store.getItem<Blob>(storageKey);
}

export async function copyMediaFile(sourceStorageKey: string, prefix: "video" | "audio", ownerId: string, mimeType: string, posterStorageKey?: string) {
    const storageKey = scopedStorageKey(prefix, ownerId);
    const nextPosterKey = posterStorageKey ? storageKey.replace(/^[^:]+:/, "poster:") : undefined;
    if (await hasStorageServer()) {
        await storageRequest("/media/copy", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sourceStorageKey, targetStorageKey: storageKey, mimeType }),
        });
    } else {
        const blob = await getMediaBlob(sourceStorageKey);
        if (!blob) throw new Error("媒体文件不存在");
        await setMediaBlob(storageKey, blob);
        if (posterStorageKey && nextPosterKey) {
            const poster = await getMediaBlob(posterStorageKey);
            if (poster) await setMediaBlob(nextPosterKey, poster);
        }
    }
    return {
        url: await resolveMediaUrl(storageKey),
        storageKey,
        bytes: 0,
        mimeType,
        posterUrl: nextPosterKey ? await resolveMediaUrl(nextPosterKey) : undefined,
        posterStorageKey: nextPosterKey,
    };
}

export async function acquireMediaUrl(storageKey?: string, fallback = "") {
    const key = storageKey || fallback;
    if (!key) return "";
    const existing = leases.get(key);
    if (existing) {
        existing.refs += 1;
        return existing.pending || existing.url;
    }
    const lease: MediaLease = { url: "", refs: 1, owned: false };
    lease.pending = (async () => {
        let url = fallback;
        if (storageKey && !(await hasStorageServer())) {
            const blob = await getMediaBlob(storageKey);
            if (blob) {
                url = URL.createObjectURL(blob);
                lease.owned = true;
            }
        } else if (storageKey) {
            url = storageMediaUrl(storageKey);
        }
        if (leases.get(key) !== lease) {
            if (lease.owned) URL.revokeObjectURL(url);
            return "";
        }
        lease.url = url;
        lease.pending = undefined;
        return url;
    })();
    leases.set(key, lease);
    return lease.pending;
}

export function releaseMediaUrl(storageKey?: string, fallback = "") {
    const key = storageKey || fallback;
    const lease = key ? leases.get(key) : undefined;
    if (!lease) return;
    lease.refs -= 1;
    if (lease.refs > 0) return;
    if (lease.owned) URL.revokeObjectURL(lease.url);
    leases.delete(key);
}

export function unloadMediaElement(element: HTMLMediaElement | null) {
    if (!element) return;
    element.pause();
    element.removeAttribute("src");
    element.load();
}

export async function setMediaBlob(storageKey: string, blob: Blob) {
    if (await hasStorageServer()) {
        await putStorageBlob(`/media/${encodeURIComponent(storageKey)}`, blob);
        return storageMediaUrl(storageKey);
    }
    await store.setItem(storageKey, blob);
    const previous = objectUrls.get(storageKey);
    if (previous) URL.revokeObjectURL(previous);
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    return url;
}

export async function deleteStoredMedia(keys: Iterable<string>) {
    const uniqueKeys = Array.from(new Set(keys));
    for (const key of uniqueKeys) {
        const url = objectUrls.get(key);
        if (url) URL.revokeObjectURL(url);
        objectUrls.delete(key);
    }
    if (await hasStorageServer()) return;
    await Promise.all(uniqueKeys.map((key) => store.removeItem(key)));
}

export function releaseMediaObjectUrls() {
    objectUrls.forEach((url) => URL.revokeObjectURL(url));
    objectUrls.clear();
}

export async function cleanupUnusedMedia(usedData: unknown) {
    if (await hasStorageServer()) return;
    const usedKeys = collectMediaStorageKeys(usedData);
    const unused: string[] = [];
    await store.iterate((_value, key) => {
        if (!usedKeys.has(key)) unused.push(key);
    });
    await Promise.all(unused.map((key) => store.removeItem(key)));
}

export function collectMediaStorageKeys(value: unknown, keys = new Set<string>()) {
    if (!value || typeof value !== "object") return keys;
    if ("storageKey" in value && typeof value.storageKey === "string" && value.storageKey.includes(":")) keys.add(value.storageKey);
    if ("posterStorageKey" in value && typeof value.posterStorageKey === "string") keys.add(value.posterStorageKey);
    Object.values(value).forEach((item) => (Array.isArray(item) ? item.forEach((child) => collectMediaStorageKeys(child, keys)) : collectMediaStorageKeys(item, keys)));
    return keys;
}

export function readVideoMeta(url: string) {
    return new Promise<{ width: number; height: number; durationMs?: number; poster?: Blob }>((resolve) => {
        const video = document.createElement("video");
        let settled = false;
        const done = (poster?: Blob) => {
            if (settled) return;
            settled = true;
            const result = { width: video.videoWidth || 1280, height: video.videoHeight || 720, durationMs: Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : undefined, poster };
            video.pause();
            video.removeAttribute("src");
            video.load();
            resolve(result);
        };
        video.preload = "auto";
        video.muted = true;
        video.playsInline = true;
        video.onloadeddata = () => {
            if (!video.videoWidth || !video.videoHeight) return done();
            const canvas = document.createElement("canvas");
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const context = canvas.getContext("2d");
            if (!context) return done();
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            canvas.toBlob((blob) => done(blob || undefined), "image/webp", 0.82);
        };
        video.onerror = () => done();
        video.src = url;
    });
}

function readAudioMeta(url: string) {
    return new Promise<{ durationMs?: number }>((resolve) => {
        const audio = document.createElement("audio");
        audio.preload = "metadata";
        let settled = false;
        const done = () => {
            if (settled) return;
            settled = true;
            const durationMs = Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : undefined;
            audio.removeAttribute("src");
            audio.load();
            resolve({ durationMs });
        };
        const timer = setTimeout(done, 3000);
        audio.onloadedmetadata = () => {
            clearTimeout(timer);
            done();
        };
        audio.onerror = () => {
            clearTimeout(timer);
            done();
        };
        audio.src = url;
    });
}
