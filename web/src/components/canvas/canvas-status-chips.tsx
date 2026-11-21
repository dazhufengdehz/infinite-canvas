import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

const MAX_REFERENCE_IMAGES = 9;

/** 画布状态胶囊：生成进度、排队数、选中节点的参考图与随机种子；无内容时整条隐藏。 */
export function CanvasStatusChips({ nodes, connections, selectedNodeIds }: { nodes: CanvasNodeData[]; connections: CanvasConnection[]; selectedNodeIds: Set<string> }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    let generatingPct = 0;
    let generatingCount = 0;
    let queueCount = 0;
    for (const node of nodes) {
        if (node.metadata?.status !== "loading") continue;
        generatingCount += 1;
        generatingPct = Math.max(generatingPct, node.metadata.progressPct ?? 0);
        if (typeof node.metadata.queuePosition === "number") queueCount += 1;
    }

    const selectedNode = selectedNodeIds.size === 1 ? nodes.find((node) => selectedNodeIds.has(node.id)) : undefined;
    const imageNodeIds = new Set(nodes.filter((node) => node.type === CanvasNodeType.Image).map((node) => node.id));
    const referenceCount = selectedNode ? connections.filter((connection) => connection.toNodeId === selectedNode.id && imageNodeIds.has(connection.fromNodeId)).length : 0;
    const seed = selectedNode?.metadata?.seed;

    const chips = [
        generatingCount ? { key: "generating", label: `生成中 ${Math.round(generatingPct)}%`, accent: true } : null,
        queueCount ? { key: "queue", label: `排队 ${queueCount}`, accent: false } : null,
        referenceCount ? { key: "reference", label: `参考 ${referenceCount} / ${MAX_REFERENCE_IMAGES}`, accent: false } : null,
        typeof seed === "number" ? { key: "seed", label: `种子 ${seed}`, accent: false } : null,
    ].filter((chip): chip is { key: string; label: string; accent: boolean } => Boolean(chip));

    if (!chips.length) return null;

    return (
        <div className="pointer-events-none absolute left-[86px] top-[76px] z-40 flex items-center gap-1.5">
            {chips.map((chip) => (
                <span
                    key={chip.key}
                    className="flex h-[26px] items-center rounded-full border px-2.5 font-mono text-[11px] font-medium tabular-nums backdrop-blur-xl"
                    style={{
                        background: theme.accent.chrome,
                        borderColor: chip.accent ? theme.accent.base : theme.hairline.base,
                        color: chip.accent ? theme.accent.base : theme.text.secondary,
                    }}
                >
                    {chip.label}
                </span>
            ))}
        </div>
    );
}
