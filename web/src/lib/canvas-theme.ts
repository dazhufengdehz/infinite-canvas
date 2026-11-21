// surface / hairline / text / state / focus 为语义 key，新增代码优先使用；
// node / toolbar 为历史 key，保留给尚未迁移的组件。
export type CanvasColorTheme = "light" | "dark";
export type CanvasBackgroundMode = "dots" | "lines" | "blank";

export const canvasThemes = {
    light: {
        mode: "light" as const,
        canvas: {
            background: "#eef3fa",
            dot: "rgba(10,60,140,.13)",
            line: "rgba(68,64,60,.12)",
            selectionStroke: "#0f8fd4",
            selectionFill: "rgba(15,143,212,.10)",
        },
        node: {
            label: "#57534e",
            fill: "#ffffff",
            panel: "#ffffff",
            stroke: "#d8e1ee",
            activeStroke: "#0f8fd4",
            placeholder: "#8a8479",
            text: "#292524",
            muted: "#78716c",
            faint: "#a8a29e",
        },
        // accent 是状态色（选中 / 生成中 / 连线），不得当作普通按钮填充底色。
        accent: {
            base: "#0f8fd4",
            alt: "#b62ed0",
            soft: "rgba(15,143,212,.14)",
            glow: "rgba(15,143,212,.28)",
            chrome: "rgba(255,255,255,.84)",
        },
        toolbar: {
            panel: "rgba(251,250,247,.96)",
            border: "#d6d3ca",
            item: "#57534e",
            itemHover: "#e7e5df",
            activeBg: "#e7e5df",
            activeText: "#292524",
        },
        surface: {
            base: "#fbfaf7",
            sunken: "#e9e5dc",
            hover: "rgba(28,25,23,.05)",
            active: "rgba(28,25,23,.09)",
        },
        hairline: {
            base: "rgba(68,64,60,.14)",
            strong: "rgba(68,64,60,.26)",
        },
        text: {
            primary: "#1c1917",
            secondary: "#57534e",
            tertiary: "#8a8479",
            inverse: "#fafaf9",
        },
        state: {
            success: "#15803d",
            warning: "#b45309",
            danger: "#b91c1c",
        },
        focus: {
            ring: "rgba(28,25,23,.3)",
        },
    },
    dark: {
        mode: "dark" as const,
        canvas: {
            background: "#06070a",
            dot: "rgba(110,175,255,.16)",
            line: "rgba(245,245,244,.10)",
            selectionStroke: "#38e1ff",
            selectionFill: "rgba(56,225,255,.12)",
        },
        node: {
            label: "#d6d3d1",
            fill: "#12161e",
            panel: "#12161e",
            stroke: "#2b3442",
            activeStroke: "#38e1ff",
            placeholder: "#a8a29e",
            text: "#f5f5f4",
            muted: "#d6d3d1",
            faint: "#78716c",
        },
        // accent 是状态色（选中 / 生成中 / 连线），不得当作普通按钮填充底色。
        accent: {
            base: "#38e1ff",
            alt: "#ff4fd8",
            soft: "rgba(56,225,255,.16)",
            glow: "rgba(56,225,255,.45)",
            chrome: "rgba(16,19,26,.72)",
        },
        toolbar: {
            panel: "rgba(31,29,26,.96)",
            border: "#44403c",
            item: "#d6d3d1",
            itemHover: "#292524",
            activeBg: "#3a3631",
            activeText: "#f5f5f4",
        },
        surface: {
            base: "#1f1d1a",
            sunken: "#2a2723",
            hover: "rgba(255,255,255,.06)",
            active: "rgba(255,255,255,.11)",
        },
        hairline: {
            base: "rgba(245,245,244,.10)",
            strong: "rgba(245,245,244,.20)",
        },
        text: {
            primary: "#f5f5f4",
            secondary: "#d6d3d1",
            tertiary: "#a8a29e",
            inverse: "#181715",
        },
        state: {
            success: "#4ade80",
            warning: "#fbbf24",
            danger: "#f87171",
        },
        focus: {
            ring: "rgba(245,245,244,.4)",
        },
    },
} as const;

export type CanvasTheme = (typeof canvasThemes)[CanvasColorTheme];
