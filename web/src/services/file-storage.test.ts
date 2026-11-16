import { afterEach, describe, expect, it, vi } from "vitest";

import { readVideoMeta } from "./file-storage";

function mockVideoElements(toBlob: HTMLCanvasElement["toBlob"]) {
    const context = { drawImage: vi.fn() };
    const video = {
        videoWidth: 1280,
        videoHeight: 720,
        duration: 1.25,
        pause: vi.fn(),
        load: vi.fn(),
        removeAttribute: vi.fn(),
    } as unknown as HTMLVideoElement;
    const canvas = {
        getContext: vi.fn(() => context),
        toBlob,
    } as unknown as HTMLCanvasElement;
    vi.spyOn(document, "createElement").mockImplementation(((tagName: string) => {
        if (tagName === "video") return video;
        if (tagName === "canvas") return canvas;
        throw new Error(`Unexpected element: ${tagName}`);
    }) as typeof document.createElement);
    return { video, context };
}

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe("readVideoMeta", () => {
    it("loads video with CORS and extracts a poster", async () => {
        const poster = new Blob(["poster"], { type: "image/webp" });
        const { video, context } = mockVideoElements((callback) => callback(poster));
        const pending = readVideoMeta("http://127.0.0.1:18080/video.mp4");

        expect(video.crossOrigin).toBe("anonymous");
        video.onloadeddata?.(new Event("loadeddata"));

        await expect(pending).resolves.toMatchObject({ width: 1280, height: 720, durationMs: 1250, poster });
        expect(context.drawImage).toHaveBeenCalledOnce();
    });

    it("returns playable metadata when poster extraction throws", async () => {
        const { video } = mockVideoElements(() => {
            throw new DOMException("The canvas is tainted", "SecurityError");
        });
        const pending = readVideoMeta("http://127.0.0.1:18080/video.mp4");

        video.onloadeddata?.(new Event("loadeddata"));

        const metadata = await pending;
        expect(metadata).toMatchObject({ width: 1280, height: 720, durationMs: 1250 });
        expect(metadata.poster).toBeUndefined();
    });

    it("falls back when video loading never emits an event", async () => {
        vi.useFakeTimers();
        mockVideoElements(vi.fn());
        const pending = readVideoMeta("http://127.0.0.1:18080/video.mp4");

        await vi.advanceTimersByTimeAsync(10_000);

        await expect(pending).resolves.toMatchObject({ width: 1280, height: 720, durationMs: 1250 });
    });
});
