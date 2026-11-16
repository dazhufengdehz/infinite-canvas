import { useCallback, useEffect, useState } from "react";
import { App, Button, Input, Segmented, Tooltip } from "antd";
import copyToClipboard from "copy-to-clipboard";
import { Bot, Copy, KeyRound, Link2, PlugZap, RefreshCw, Terminal } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { fetchTraeStatus, fetchWorkbuddyConfig, fetchWorkbuddyStatus, saveWorkbuddyConfig, type TraeStatusResponse } from "@/services/api/canvas-agent";
import type { AgentProvider } from "@/stores/use-agent-store";

const LOCAL_AGENT_COMMAND = "npx -y @zhuyichuan/canvas-agent";
const TRAE_LOGIN_COMMAND = "traecli login";
const TRAE_MCP_CONFIG = JSON.stringify({ mcpServers: { "infinite-canvas": { command: "npx", args: ["-y", "@zhuyichuan/canvas-agent", "mcp"] } } }, null, 2);

export function AgentConnectView({
    theme,
    provider,
    url,
    token,
    enabled,
    connected,
    busy,
    activity,
    connectError,
    onProviderChange,
    onUrlChange,
    onTokenChange,
    onToggleEnabled,
}: {
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    provider: AgentProvider;
    url: string;
    token: string;
    enabled: boolean;
    connected: boolean;
    busy: boolean;
    activity: string;
    connectError: string;
    onProviderChange: (value: AgentProvider) => void;
    onUrlChange: (value: string) => void;
    onTokenChange: (value: string) => void;
    onToggleEnabled: () => void;
}) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const [wbToken, setWbToken] = useState("");
    const [wbOnline, setWbOnline] = useState<boolean | null>(null);
    const [wbChecking, setWbChecking] = useState(false);
    const [wbSaving, setWbSaving] = useState(false);
    const [traeStatus, setTraeStatus] = useState<TraeStatusResponse | null>(null);
    const [traeChecking, setTraeChecking] = useState(false);

    const handleCheckTraeStatus = useCallback(async () => {
        if (!connected) return;
        setTraeChecking(true);
        try {
            setTraeStatus(await fetchTraeStatus(url, token));
        } catch (error) {
            setTraeStatus({ available: false, error: error instanceof Error ? error.message : String(error) });
        } finally {
            setTraeChecking(false);
        }
    }, [connected, token, url]);

    useEffect(() => {
        if (provider !== "trae" || !connected) {
            setTraeStatus(null);
            return;
        }
        void handleCheckTraeStatus();
    }, [connected, handleCheckTraeStatus, provider]);

    useEffect(() => {
        if (!connected || !url || !token) return;
        let active = true;
        void fetchWorkbuddyConfig(url, token).then((res) => {
            if (!active) return;
            if (res.hasToken) {
                void fetchWorkbuddyStatus(url, token).then((status) => {
                    if (active) setWbOnline(Boolean(status.online));
                });
            }
        });
        return () => { active = false; };
    }, [connected, url, token]);

    const handleCheckWbStatus = async () => {
        if (!connected) return;
        setWbChecking(true);
        try {
            const res = await fetchWorkbuddyStatus(url, token);
            setWbOnline(Boolean(res.online));
            if (res.online) message.success("WorkBuddy 桌面端助理在线");
            else message.warning(res.error || "未检测到 WorkBuddy 桌面端运行");
        } catch {
            setWbOnline(false);
            message.error("检测失败，请确保本地 Agent 已连接");
        } finally {
            setWbChecking(false);
        }
    };

    const handleSaveWbToken = async () => {
        if (!connected) {
            message.warning("请先连接本地 Canvas Agent");
            return;
        }
        setWbSaving(true);
        try {
            await saveWorkbuddyConfig(url, token, { accessToken: wbToken.trim() });
            message.success("WorkBuddy 配置已保存");
            void handleCheckWbStatus();
        } catch (err) {
            message.error(err instanceof Error ? err.message : "保存配置失败");
        } finally {
            setWbSaving(false);
        }
    };

    const statusText = connectError ? t("agent.status.failed") : connected ? activity : enabled ? t("agent.status.connecting") : t("agent.status.disconnected");
    const statusColor = connectError ? "#dc2626" : connected ? "#16a34a" : enabled ? "#d97706" : theme.node.muted;

    const copyCommand = (command: string) => {
        copyToClipboard(command);
        message.success(t("agent.connect.commandCopied"));
    };

    return (
        <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
            <div className="space-y-4">
                <div>
                    <div className="text-base font-semibold leading-6">{t("agent.connect.title")}</div>
                    <div className="mt-1 text-xs leading-5" style={{ color: theme.node.muted }}>
                        {t("agent.connect.description")}
                    </div>
                </div>

                <div className="grid gap-2">
                    <span className="text-xs font-medium" style={{ color: theme.node.muted }}>{t("agent.connect.provider")}</span>
                    <Segmented
                        block
                        value={provider}
                        disabled={busy}
                        options={[
                            { label: "WorkBuddy", value: "workbuddy" },
                            { label: "Codex", value: "codex" },
                            { label: "Trae", value: "trae" },
                        ]}
                        onChange={(value) => onProviderChange(value as AgentProvider)}
                    />
                </div>

                {provider === "trae" ? (
                    <div className="rounded-lg border p-3.5" style={{ borderColor: theme.node.stroke }}>
                        <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                    <Bot className="size-4 shrink-0" />
                                    <span className="text-sm font-medium leading-5">Trae CLI</span>
                                    <span className="text-[11px]" style={{ color: traeStatus?.available ? "#16a34a" : traeStatus ? "#d97706" : theme.node.muted }}>
                                        {traeChecking ? t("agent.connect.traeChecking") : traeStatus?.available ? t("agent.connect.traeAvailable") : traeStatus ? t("agent.connect.traeUnavailable") : t("agent.connect.traeWaiting")}
                                    </span>
                                </div>
                                <div className="mt-1 text-xs leading-5" style={{ color: theme.node.muted }}>
                                    {traeStatus?.available ? traeStatus.version || t("agent.connect.traeDescription") : traeStatus?.error || t("agent.connect.traeDescription")}
                                </div>
                            </div>
                            <Button className="!h-8 !px-3" icon={<RefreshCw className={`size-3.5 ${traeChecking ? "animate-spin" : ""}`} />} onClick={() => void handleCheckTraeStatus()} disabled={!connected || traeChecking}>
                                {t("agent.connect.refreshStatus")}
                            </Button>
                        </div>
                        {!traeStatus?.available ? (
                            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                                <span className="text-[11px] leading-4" style={{ color: theme.node.muted }}>{t("agent.connect.traeInstallHint")}</span>
                                <Button size="small" type="text" icon={<Copy className="size-3.5" />} onClick={() => copyCommand(TRAE_LOGIN_COMMAND)}>{TRAE_LOGIN_COMMAND}</Button>
                            </div>
                        ) : null}
                        <div className="mt-3 border-t pt-3" style={{ borderColor: theme.node.stroke }}>
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="text-xs font-medium">{t("agent.connect.traeMcpTitle")}</span>
                                <Button size="small" type="text" icon={<Copy className="size-3.5" />} onClick={() => { copyToClipboard(TRAE_MCP_CONFIG); message.success(t("agent.connect.mcpCopied")); }}>
                                    {t("agent.connect.copyMcpConfig")}
                                </Button>
                            </div>
                            <div className="mt-1 text-[11px] leading-4" style={{ color: theme.node.muted }}>{t("agent.connect.traeMcpHint")}</div>
                            <pre className="thin-scrollbar mt-2 max-h-40 overflow-auto rounded-md border p-2 text-[10px] leading-4" style={{ borderColor: theme.node.stroke, color: theme.node.text }}><code>{TRAE_MCP_CONFIG}</code></pre>
                        </div>
                    </div>
                ) : null}

                {/* 1. WorkBuddy 桌面助理配置卡片（暂时隐藏） */}
                {/* <div className="rounded-lg border p-3.5" style={{ borderColor: theme.node.stroke }}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 items-center gap-2">
                                <Bot className="size-4 shrink-0" />
                                <span className="shrink-0 text-sm font-medium leading-5">WorkBuddy 桌面助理</span>
                                <span
                                    className="inline-flex min-w-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] leading-4"
                                    style={{
                                        borderColor: wbOnline ? "#16a34a" : wbOnline === false ? "#d97706" : theme.node.stroke,
                                        color: wbOnline ? "#16a34a" : wbOnline === false ? "#d97706" : theme.node.muted,
                                    }}
                                >
                                    <span
                                        className="size-1.5 shrink-0 rounded-full"
                                        style={{ background: wbOnline ? "#16a34a" : wbOnline === false ? "#d97706" : theme.node.muted }}
                                    />
                                    <span className="truncate">{wbChecking ? "检测中..." : wbOnline ? "桌面助理在线" : wbOnline === false ? "未检测到运行" : "待配置"}</span>
                                </span>
                            </div>
                            <div className="mt-1 text-xs leading-5" style={{ color: theme.node.muted }}>
                                配置 WorkBuddy Access Token 即可直连本机正在运行的 WorkBuddy 桌面端助理，享受双向智能协同。
                            </div>
                        </div>
                        <Button className="!h-8 !px-3" icon={<RefreshCw className={`size-3.5 ${wbChecking ? "animate-spin" : ""}`} />} onClick={() => void handleCheckWbStatus()} disabled={!connected}>
                            刷新状态
                        </Button>
                    </div>
                    <div className="mt-3 grid gap-2.5">
                        <label className="grid gap-1.5">
                            <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color: theme.node.muted }}>
                                <KeyRound className="size-3.5" />
                                WorkBuddy Access Token
                                <span className="font-normal opacity-70">open.workbuddy.cn</span>
                            </span>
                            <Input.Password
                                size="large"
                                prefix={<KeyRound className="mr-1 size-4" style={{ color: theme.node.faint }} />}
                                value={wbToken}
                                onChange={(event) => setWbToken(event.target.value)}
                                placeholder="填入在 WorkBuddy 开放平台生成的 Access Token"
                            />
                        </label>
                        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                            <span className="text-[11px]" style={{ color: theme.node.muted }}>
                                权限需求：user.localassistant.readable, user.localassistant.invokable
                            </span>
                            <Button type="primary" className="!h-8 !px-3" loading={wbSaving} onClick={() => void handleSaveWbToken()} disabled={!connected}>
                                保存配置
                            </Button>
                        </div>
                    </div>
                </div> */}

                {/* 2. 本地 Canvas Agent 桥接服务连接卡片 */}
                <div className="rounded-lg border p-3.5" style={{ borderColor: theme.node.stroke }}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 items-center gap-2">
                                <span className="shrink-0 text-sm font-medium leading-5">{t("agent.connect.webConnection")}</span>
                                <span
                                    className="inline-flex min-w-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] leading-4"
                                    style={{ borderColor: connected || enabled || connectError ? statusColor : theme.node.stroke, color: statusColor }}
                                >
                                    <span className="size-1.5 shrink-0 rounded-full" style={{ background: statusColor }} />
                                    <span className="truncate">{statusText}</span>
                                </span>
                            </div>
                            <div className="mt-1 text-xs leading-5" style={{ color: theme.node.muted }}>
                                {t("agent.connect.autoDiscover")}
                            </div>
                        </div>
                        <Button className="!h-8 !px-3" type={enabled ? "default" : "primary"} icon={<PlugZap className="size-4" />} onClick={onToggleEnabled} disabled={busy}>
                            {t(enabled ? "agent.connect.disconnect" : "agent.connect.connect")}
                        </Button>
                    </div>
                    <div className="mt-3 grid gap-2.5">
                        <label className="grid gap-1.5">
                            <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color: theme.node.muted }}>
                                <Link2 className="size-3.5" />
                                {t("agent.connect.localAddress")}
                                <span className="font-normal opacity-70">Local URL</span>
                            </span>
                            <Input size="large" prefix={<Link2 className="mr-1 size-4" style={{ color: theme.node.faint }} />} value={url} onChange={(event) => onUrlChange(event.target.value)} placeholder={t("agent.connect.urlPlaceholder")} />
                        </label>
                        <label className="grid gap-1.5">
                            <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color: theme.node.muted }}>
                                <KeyRound className="size-3.5" />
                                {t("agent.connect.token")}
                                <span className="font-normal opacity-70">Connect token</span>
                            </span>
                            <Input.Password
                                size="large"
                                prefix={<KeyRound className="mr-1 size-4" style={{ color: theme.node.faint }} />}
                                value={token}
                                onChange={(event) => onTokenChange(event.target.value)}
                                placeholder={t("agent.connect.tokenPlaceholder")}
                            />
                        </label>
                        {connectError ? (
                            <div className="rounded-md border px-2.5 py-2 text-xs leading-5" style={{ borderColor: "rgba(220,38,38,.35)", color: "#dc2626" }}>
                                {connectError}
                            </div>
                        ) : null}
                    </div>
                </div>

                {/* 3. 启动本地服务引导 */}
                <div className="rounded-lg border p-3.5" style={{ borderColor: theme.node.stroke }}>
                    <div className="flex items-center gap-2">
                        <Terminal className="size-4 shrink-0" />
                        <div className="text-sm font-medium leading-5">{t("agent.connect.directTitle")}</div>
                    </div>
                    <div className="mt-1 text-xs leading-5" style={{ color: theme.node.muted }}>
                        {t("agent.connect.directText")}
                    </div>
                    <div className="mt-2.5 flex items-center gap-2 rounded-md border bg-transparent px-2 py-1.5" style={{ borderColor: theme.node.stroke, color: theme.node.text }}>
                        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-[11px] leading-5">{LOCAL_AGENT_COMMAND}</code>
                        <Tooltip title={t("agent.connect.copyCommand")}>
                            <Button size="small" type="text" className="!h-6 !w-6 !min-w-6" icon={<Copy className="size-3.5" />} onClick={() => copyCommand(LOCAL_AGENT_COMMAND)} />
                        </Tooltip>
                    </div>
                    <div className="mt-2 text-[11px] leading-4" style={{ color: theme.node.muted }}>
                        提示：在 WorkBuddy 连接器中心安装 Infinite Canvas 连接器后，亦可自动按需启动。
                    </div>
                </div>
            </div>
        </div>
    );
}
