import type { AlignmentGuideLine } from "@/lib/canvas/canvas-alignment-snapping";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";

export function CanvasAlignmentGuides({
    guides,
    viewportScale,
}: {
    guides: AlignmentGuideLine[];
    viewportScale: number;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    if (!guides || guides.length === 0) return null;
    const scale = Math.max(0.1, viewportScale);
    const strokeWidth = 1.2 / scale;
    const dash = `${4 / scale} ${3 / scale}`;

    return (
        <g className="pointer-events-none" style={{ zIndex: 90 }}>
            {guides.map((guide) => {
                if (guide.orientation === "vertical") {
                    return (
                        <line
                            key={guide.id}
                            x1={guide.position}
                            y1={guide.start}
                            x2={guide.position}
                            y2={guide.end}
                            stroke={theme.canvas.selectionStroke}
                            strokeWidth={strokeWidth}
                            strokeDasharray={dash}
                            strokeOpacity={0.88}
                        />
                    );
                }
                return (
                    <line
                        key={guide.id}
                        x1={guide.start}
                        y1={guide.position}
                        x2={guide.end}
                        y2={guide.position}
                        stroke={theme.canvas.selectionStroke}
                        strokeWidth={strokeWidth}
                        strokeDasharray={dash}
                        strokeOpacity={0.88}
                    />
                );
            })}
        </g>
    );
}
