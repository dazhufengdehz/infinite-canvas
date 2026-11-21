import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type PageHeaderProps = {
    eyebrow?: string;
    title: string;
    description?: string;
    actions?: ReactNode;
    className?: string;
};

/** 页面头部统一规格：eyebrow / 标题 / 说明 / 右上主操作。 */
export function PageHeader({ eyebrow, title, description, actions, className }: PageHeaderProps) {
    return (
        <header className={cn("flex flex-wrap items-end justify-between gap-4 border-b border-hairline pb-6", className)}>
            <div className="min-w-0">
                {eyebrow ? <p className="text-micro font-medium tracking-[0.14em] text-ink-faint uppercase">{eyebrow}</p> : null}
                <h1 className="mt-2 text-display font-semibold text-ink">{title}</h1>
                {description ? <p className="mt-2 text-body text-ink-soft">{description}</p> : null}
            </div>
            {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </header>
    );
}
