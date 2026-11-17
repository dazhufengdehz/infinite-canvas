import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from "react";
import type { ReactNode } from "react";

import type { AlignmentGuideLine } from "@/lib/canvas/canvas-alignment-snapping";
import type { CanvasNodeData, Position, ViewportTransform } from "@/types/canvas";
import { InfiniteCanvas, type InfiniteCanvasProps } from "./infinite-canvas";

export type CanvasSceneState = {
    nodes: CanvasNodeData[];
    viewport: ViewportTransform;
    mouseWorld: Position;
    alignmentGuides: AlignmentGuideLine[];
};

export type CanvasSceneHandle = {
    previewNodes: (nodes: CanvasNodeData[]) => void;
    previewViewport: (viewport: ViewportTransform) => void;
    commitViewport: (viewport: ViewportTransform) => void;
    previewMouseWorld: (position: Position) => void;
    previewAlignmentGuides: (guides: AlignmentGuideLine[]) => void;
};

type CanvasSceneProps = Omit<InfiniteCanvasProps, "children" | "overlay" | "viewport" | "onViewportChange" | "onViewportPreview"> & {
    nodes: CanvasNodeData[];
    viewport: ViewportTransform;
    onNodesPreview: (nodes: CanvasNodeData[]) => void;
    onViewportPreview: (viewport: ViewportTransform) => void;
    onViewportChange: (viewport: ViewportTransform) => void;
    children: (state: CanvasSceneState) => ReactNode;
    overlay?: (state: CanvasSceneState) => ReactNode;
};

export const CanvasScene = forwardRef<CanvasSceneHandle, CanvasSceneProps>(function CanvasScene(
    { nodes, viewport, onNodesPreview, onViewportPreview, onViewportChange, children, overlay, ...canvasProps },
    ref,
) {
    const [sceneNodes, setSceneNodes] = useState(nodes);
    const [sceneViewport, setSceneViewport] = useState(viewport);
    const [mouseWorld, setMouseWorld] = useState<Position>({ x: 0, y: 0 });
    const [alignmentGuides, setAlignmentGuides] = useState<AlignmentGuideLine[]>([]);

    useEffect(() => setSceneNodes(nodes), [nodes]);
    useEffect(() => setSceneViewport(viewport), [viewport]);

    const previewNodes = useCallback((next: CanvasNodeData[]) => {
        setSceneNodes(next);
        onNodesPreview(next);
    }, [onNodesPreview]);
    const previewViewport = useCallback((next: ViewportTransform) => {
        setSceneViewport(next);
        onViewportPreview(next);
    }, [onViewportPreview]);
    const commitViewport = useCallback((next: ViewportTransform) => {
        previewViewport(next);
        onViewportChange(next);
    }, [onViewportChange, previewViewport]);

    useImperativeHandle(ref, () => ({
        previewNodes,
        previewViewport,
        commitViewport,
        previewMouseWorld: setMouseWorld,
        previewAlignmentGuides: setAlignmentGuides,
    }), [commitViewport, previewNodes, previewViewport]);

    const state = { nodes: sceneNodes, viewport: sceneViewport, mouseWorld, alignmentGuides };
    return (
        <InfiniteCanvas
            {...canvasProps}
            viewport={sceneViewport}
            onViewportPreview={previewViewport}
            onViewportChange={commitViewport}
            overlay={overlay?.(state)}
        >
            {children(state)}
        </InfiniteCanvas>
    );
});
