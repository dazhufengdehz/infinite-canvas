import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";

import { cn } from "@/lib/utils";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

const VARIANTS: Record<ButtonVariant, string> = {
    primary: "bg-action text-action-ink hover:bg-action/90",
    secondary: "border border-hairline bg-surface text-ink hover:bg-surface-hover",
    ghost: "text-ink-soft hover:bg-surface-hover hover:text-ink",
    danger: "text-danger hover:bg-surface-hover",
};

const SIZES: Record<ButtonSize, string> = {
    sm: "h-7 gap-1.5 px-2.5 text-label",
    md: "h-[34px] gap-2 px-3.5 text-label",
    lg: "h-9 gap-2 px-4 text-body",
};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: ButtonVariant;
    size?: ButtonSize;
    icon?: ReactNode;
    ref?: Ref<HTMLButtonElement>;
};

export function Button({ variant = "secondary", size = "md", icon, className, type = "button", children, ref, ...props }: ButtonProps) {
    return (
        <button
            ref={ref}
            type={type}
            className={cn(
                "inline-flex shrink-0 items-center justify-center rounded-control font-medium whitespace-nowrap transition-colors duration-[var(--motion-hover)] ease-quiet outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:pointer-events-none disabled:opacity-45",
                VARIANTS[variant],
                SIZES[size],
                className,
            )}
            {...props}
        >
            {icon ? <span className="inline-flex shrink-0 items-center [&_svg]:size-4">{icon}</span> : null}
            {children}
        </button>
    );
}

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
    size?: "sm" | "md";
    ref?: Ref<HTMLButtonElement>;
};

export function IconButton({ className, size = "md", type = "button", children, ref, ...props }: IconButtonProps) {
    return (
        <button
            ref={ref}
            type={type}
            className={cn(
                "inline-flex shrink-0 items-center justify-center rounded-control text-ink-soft transition-colors duration-[var(--motion-hover)] ease-quiet outline-none hover:bg-surface-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-focus disabled:pointer-events-none disabled:opacity-45",
                size === "sm" ? "size-[26px] [&_svg]:size-3.5" : "size-8 [&_svg]:size-4",
                className,
            )}
            {...props}
        >
            {children}
        </button>
    );
}
