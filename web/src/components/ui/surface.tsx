import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type PanelProps = {
    className?: string;
    elevated?: boolean;
    children: ReactNode;
};

export function Panel({ className, elevated, children }: PanelProps) {
    return <div className={cn("rounded-panel border border-hairline bg-surface text-ink", elevated && "shadow-float", className)}>{children}</div>;
}

type HairlineProps = {
    vertical?: boolean;
    className?: string;
};

export function Hairline({ vertical, className }: HairlineProps) {
    return <div role="separator" aria-orientation={vertical ? "vertical" : "horizontal"} className={cn(vertical ? "w-px self-stretch" : "h-px w-full", "bg-hairline", className)} />;
}
