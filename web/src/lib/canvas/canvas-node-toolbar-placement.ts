import type { CanvasNodeData, ViewportTransform } from "@/types/canvas";

export const CANVAS_NODE_TOOLBAR_HEIGHT = 40;

export function getCanvasNodeToolbarPlacement(node: CanvasNodeData, viewport: ViewportTransform) {
    const nodeTop = viewport.y + node.position.y * viewport.k;
    const nodeBottom = viewport.y + (node.position.y + node.height) * viewport.k;
    const titleGap = Math.max(26 * viewport.k, 22) + 4;
    const placement = nodeTop - titleGap - CANVAS_NODE_TOOLBAR_HEIGHT < 60 ? "bottom" : "top";
    return {
        placement,
        left: viewport.x + (node.position.x + node.width / 2) * viewport.k,
        top: placement === "bottom" ? nodeBottom + 16 : nodeTop - titleGap,
    } as const;
}
