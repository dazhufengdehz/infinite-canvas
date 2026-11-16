import { useCallback, useEffect, useRef, useState } from "react";
import { LoaderCircle, Maximize2, Pause, Play, Video, Volume2, VolumeX } from "lucide-react";
import { useTranslation } from "react-i18next";

import { acquireMediaUrl, releaseMediaUrl, unloadMediaElement } from "@/services/file-storage";

type CanvasVideoPlayerProps = {
    nodeId: string;
    src: string;
    storageKey?: string;
    posterUrl?: string;
    autoPlay?: boolean;
    onPreview?: () => void;
};

function formatTime(seconds: number): string {
    if (!Number.isFinite(seconds) || isNaN(seconds) || seconds < 0) return "00:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export function CanvasVideoPlayer({ nodeId, src, storageKey, posterUrl, autoPlay = false, onPreview }: CanvasVideoPlayerProps) {
    const { t } = useTranslation();
    const containerRef = useRef<HTMLDivElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const currentTimeRef = useRef(0);
    const leaseRef = useRef<{ storageKey?: string; src: string } | null>(null);
    const requestRef = useRef(0);
    const playRequestedRef = useRef(false);
    const unloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [active, setActive] = useState(false);
    const [resolvedSrc, setResolvedSrc] = useState("");
    const [loading, setLoading] = useState(false);
    const [isPlaying, setIsPlaying] = useState(false);
    const [isMuted, setIsMuted] = useState(true);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [isHovered, setIsHovered] = useState(false);
    const [isScrubbing, setIsScrubbing] = useState(false);

    const clearUnloadTimer = useCallback(() => {
        if (unloadTimerRef.current) clearTimeout(unloadTimerRef.current);
        unloadTimerRef.current = null;
    }, []);

    const releaseLease = useCallback(() => {
        const lease = leaseRef.current;
        if (lease) releaseMediaUrl(lease.storageKey, lease.src);
        leaseRef.current = null;
    }, []);

    const deactivate = useCallback(() => {
        requestRef.current += 1;
        clearUnloadTimer();
        if (videoRef.current) currentTimeRef.current = videoRef.current.currentTime;
        unloadMediaElement(videoRef.current);
        releaseLease();
        playRequestedRef.current = false;
        setResolvedSrc("");
        setActive(false);
        setLoading(false);
        setIsPlaying(false);
    }, [clearUnloadTimer, releaseLease]);

    useEffect(() => {
        currentTimeRef.current = 0;
        playRequestedRef.current = false;
        setResolvedSrc("");
        setActive(false);
        setLoading(false);
        setIsPlaying(false);
        setCurrentTime(0);
        setDuration(0);
        return () => {
            requestRef.current += 1;
            clearUnloadTimer();
            unloadMediaElement(videoRef.current);
            releaseLease();
        };
    }, [clearUnloadTimer, releaseLease, src, storageKey]);

    useEffect(() => {
        if (!active || !containerRef.current) return;
        const observer = new IntersectionObserver(([entry]) => {
            if (entry.isIntersecting) {
                clearUnloadTimer();
                return;
            }
            videoRef.current?.pause();
            if (!unloadTimerRef.current) unloadTimerRef.current = setTimeout(deactivate, 30_000);
        });
        observer.observe(containerRef.current);
        return () => observer.disconnect();
    }, [active, clearUnloadTimer, deactivate]);

    const activate = useCallback(async (play: boolean) => {
        const request = ++requestRef.current;
        playRequestedRef.current = play;
        setActive(true);
        if (resolvedSrc) {
            if (play) void videoRef.current?.play().catch((error) => console.warn("Canvas video play failed:", error));
            return;
        }
        setLoading(true);
        leaseRef.current = { storageKey, src };
        try {
            const url = await acquireMediaUrl(storageKey, src);
            if (requestRef.current !== request) return;
            if (!url) throw new Error("媒体文件不存在");
            setResolvedSrc(url);
        } catch (error) {
            if (requestRef.current === request) {
                releaseLease();
                playRequestedRef.current = false;
                setActive(false);
                console.warn("Canvas video load failed:", error);
            }
        } finally {
            if (requestRef.current === request) setLoading(false);
        }
    }, [releaseLease, resolvedSrc, src, storageKey]);

    useEffect(() => {
        if (autoPlay && !active && !loading && !resolvedSrc) void activate(true);
    }, [activate, active, autoPlay, loading, resolvedSrc]);

    const handleTogglePlay = useCallback((event: React.MouseEvent) => {
        event.stopPropagation();
        if (loading) return;
        if (!active || !resolvedSrc) {
            void activate(true);
            return;
        }
        const video = videoRef.current;
        if (!video) return;
        if (video.paused) {
            playRequestedRef.current = true;
            void video.play().catch((err) => console.warn("Canvas video play failed:", err));
        } else {
            playRequestedRef.current = false;
            video.pause();
        }
    }, [activate, active, loading, resolvedSrc]);

    const handleToggleMute = useCallback((event: React.MouseEvent) => {
        event.stopPropagation();
        const video = videoRef.current;
        if (!video) return;
        video.muted = !video.muted;
        setIsMuted(video.muted);
    }, []);

    const handleSeek = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        const time = Number(event.target.value);
        currentTimeRef.current = time;
        setCurrentTime(time);
        if (videoRef.current) videoRef.current.currentTime = time;
    }, []);

    const handlePreview = useCallback((event?: React.MouseEvent) => {
        event?.stopPropagation();
        playRequestedRef.current = false;
        videoRef.current?.pause();
        onPreview?.();
    }, [onPreview]);

    const showControls = active && (!isPlaying || isHovered || isScrubbing);

    return (
        <div
            ref={containerRef}
            className="group relative flex h-full w-full select-none items-center justify-center overflow-hidden rounded-[18px] bg-black"
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            {posterUrl ? <img src={posterUrl} alt="" draggable={false} className="pointer-events-none absolute inset-0 size-full object-contain" /> : null}
            {!posterUrl && !active ? <Video className="size-10 text-white/30" /> : null}
            {active && resolvedSrc ? (
                <video
                    ref={videoRef}
                    src={resolvedSrc}
                    data-canvas-video={nodeId}
                    data-canvas-no-zoom
                    loop
                    muted={isMuted}
                    playsInline
                    preload="metadata"
                    className="pointer-events-none relative size-full object-contain"
                    onPlay={() => setIsPlaying(true)}
                    onPause={() => setIsPlaying(false)}
                    onTimeUpdate={() => {
                        if (!isScrubbing && videoRef.current) {
                            currentTimeRef.current = videoRef.current.currentTime;
                            setCurrentTime(videoRef.current.currentTime);
                        }
                    }}
                    onLoadedMetadata={() => {
                        const video = videoRef.current;
                        if (!video) return;
                        setDuration(video.duration || 0);
                        video.currentTime = Math.min(currentTimeRef.current, video.duration || currentTimeRef.current);
                        if (playRequestedRef.current) void video.play().catch(() => setIsPlaying(false));
                    }}
                    onEnded={() => setIsPlaying(false)}
                />
            ) : null}

            <button
                type="button"
                className={`absolute z-10 flex size-12 cursor-pointer items-center justify-center rounded-full bg-black/60 text-white shadow-xl backdrop-blur-md transition-all duration-200 hover:scale-110 hover:bg-black/80 active:scale-95 ${
                    isPlaying ? "pointer-events-none opacity-0" : "pointer-events-auto opacity-100"
                }`}
                onClick={handleTogglePlay}
                onDoubleClick={handlePreview}
                onMouseDown={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                aria-label={t("canvas.videoPlayer.play")}
            >
                {loading ? <LoaderCircle className="size-5 animate-spin" /> : <Play className="size-5 translate-x-0.5 fill-white" />}
            </button>

            {active ? (
                <div
                    className={`absolute inset-x-2 bottom-2 z-10 flex flex-col gap-1.5 rounded-xl bg-black/70 px-2.5 py-1.5 text-white shadow-lg backdrop-blur-md transition-opacity duration-200 ${
                        showControls ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
                    }`}
                    onMouseDown={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                >
                    <input
                        type="range"
                        min={0}
                        max={duration || 1}
                        step={0.01}
                        value={currentTime}
                        onChange={handleSeek}
                        onMouseDown={(e) => {
                            e.stopPropagation();
                            setIsScrubbing(true);
                        }}
                        onMouseUp={() => setIsScrubbing(false)}
                        onTouchStart={(e) => {
                            e.stopPropagation();
                            setIsScrubbing(true);
                        }}
                        onTouchEnd={() => setIsScrubbing(false)}
                        className="h-1 w-full cursor-pointer appearance-none rounded-full bg-white/25 accent-white outline-none hover:bg-white/40"
                    />
                    <div className="flex items-center justify-between text-[11px] font-medium leading-none text-white/90">
                        <div className="flex items-center gap-1.5">
                            <button
                                type="button"
                                className="flex size-6 cursor-pointer items-center justify-center rounded-md transition hover:bg-white/20 active:scale-90"
                                onClick={handleTogglePlay}
                                title={isPlaying ? t("canvas.videoPlayer.pause") : t("canvas.videoPlayer.play")}
                            >
                                {isPlaying ? <Pause className="size-3.5 fill-white" /> : <Play className="size-3.5 translate-x-0.25 fill-white" />}
                            </button>
                            <span className="select-none text-[10px] tabular-nums opacity-80">{formatTime(currentTime)} / {formatTime(duration)}</span>
                        </div>
                        <div className="flex items-center gap-1">
                            <button
                                type="button"
                                className="flex size-6 cursor-pointer items-center justify-center rounded-md transition hover:bg-white/20 active:scale-90"
                                onClick={handleToggleMute}
                                title={isMuted ? t("canvas.videoPlayer.unmute") : t("canvas.videoPlayer.mute")}
                            >
                                {isMuted ? <VolumeX className="size-3.5" /> : <Volume2 className="size-3.5" />}
                            </button>
                            {onPreview ? (
                                <button
                                    type="button"
                                    className="flex size-6 cursor-pointer items-center justify-center rounded-md transition hover:bg-white/20 active:scale-90"
                                    onClick={handlePreview}
                                    title={t("canvas.videoPlayer.preview")}
                                >
                                    <Maximize2 className="size-3.5" />
                                </button>
                            ) : null}
                        </div>
                    </div>
                </div>
            ) : null}
        </div>
    );
}

export function LazyAudioPlayer({ src, storageKey, autoPlay = false, className = "w-full" }: { src: string; storageKey?: string; autoPlay?: boolean; className?: string }) {
    const { t } = useTranslation();
    const audioRef = useRef<HTMLAudioElement>(null);
    const leaseRef = useRef<{ storageKey?: string; src: string } | null>(null);
    const requestRef = useRef(0);
    const [resolvedUrl, setResolvedUrl] = useState("");
    const [loading, setLoading] = useState(false);

    const releaseLease = useCallback(() => {
        const lease = leaseRef.current;
        if (lease) releaseMediaUrl(lease.storageKey, lease.src);
        leaseRef.current = null;
    }, []);

    useEffect(() => {
        setResolvedUrl("");
        setLoading(false);
        return () => {
            requestRef.current += 1;
            unloadMediaElement(audioRef.current);
            releaseLease();
        };
    }, [releaseLease, src, storageKey]);

    const activate = useCallback(async () => {
        if (loading) return;
        const request = ++requestRef.current;
        setLoading(true);
        leaseRef.current = { storageKey, src };
        try {
            const url = await acquireMediaUrl(storageKey, src);
            if (requestRef.current !== request) return;
            if (!url) throw new Error("媒体文件不存在");
            setResolvedUrl(url);
        } catch (error) {
            if (requestRef.current === request) {
                releaseLease();
                console.warn("Audio load failed:", error);
            }
        } finally {
            if (requestRef.current === request) setLoading(false);
        }
    }, [loading, releaseLease, src, storageKey]);

    useEffect(() => {
        if (autoPlay && (src || storageKey) && !resolvedUrl && !loading) void activate();
    }, [activate, autoPlay, loading, resolvedUrl, src, storageKey]);

    if (!src && !storageKey) return null;
    if (resolvedUrl) return <audio ref={audioRef} src={resolvedUrl} controls autoPlay className={className} data-canvas-no-zoom />;
    return (
        <button type="button" disabled={loading} className="flex items-center justify-center gap-2 rounded-md py-2 text-sm hover:bg-black/5 disabled:opacity-50 dark:hover:bg-white/10" onClick={() => void activate()}>
            <Play className="size-4" />
            {t("canvas.videoPlayer.play")}
        </button>
    );
}
