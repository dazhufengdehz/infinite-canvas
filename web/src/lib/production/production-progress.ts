import { t } from "@/i18n";
import { listShots } from "@/lib/production/production-model";
import type { ProductionState } from "@/types/canvas";

export type ProductionStage = "source" | "setting" | "outline" | "script" | "assets" | "storyboard" | "shots";

export const PRODUCTION_STAGES: ProductionStage[] = ["source", "setting", "outline", "script", "assets", "storyboard", "shots"];

export type StageAction = "generateSetting" | "generateOutline" | "generateScript" | "generateAssets" | "generateStoryboard" | "generateShots";

export type StageProgress = {
    stage: ProductionStage;
    /** 是否已完成该阶段的最小产出。 */
    done: boolean;
    /** 当前阶段未完成的阻塞原因（中文）。 */
    blockers: string[];
    /** 完成该阶段的下一步动作（可直接触发）。 */
    nextAction: { label: string; action: StageAction; disabled: boolean };
    /** 该阶段已产出的数量，用于进度标注。 */
    count: number;
    /** 该阶段产出的总量目标，无法确定时为 0。 */
    total: number;
};

/** 按生产数据推导七阶段进度与当前应处阶段。 */
export function deriveStageProgress(data: ProductionState): StageProgress[] {
    const episodes = data.episodes;
    const shots = listShots(data);
    const scriptReady = episodes.filter((episode) => episode.script.trim()).length;
    const storyboardReady = episodes.filter((episode) => episode.shots.length).length;
    const synopsisReady = episodes.filter((episode) => episode.synopsis.trim()).length;
    const hasSource = Boolean(data.source.text.trim());
    const hasSetting = Boolean(data.setting.trim());
    const hasAssets = data.assets.length > 0;

    return [
        {
            stage: "source",
            done: hasSource,
            blockers: hasSource ? [] : [t("canvas.production.blocking.emptySource")],
            nextAction: { label: t("canvas.production.nextStep.generateSetting"), action: "generateSetting", disabled: !hasSource },
            count: hasSource ? 1 : 0,
            total: 1,
        },
        {
            stage: "setting",
            done: hasSetting,
            blockers: hasSetting ? [] : hasSource ? [t("canvas.production.blocking.emptySetting")] : [t("canvas.production.blocking.emptySource")],
            nextAction: { label: t("canvas.production.nextStep.generateOutline"), action: "generateOutline", disabled: !hasSetting },
            count: hasSetting ? 1 : 0,
            total: 1,
        },
        {
            stage: "outline",
            done: episodes.length > 0 && synopsisReady === episodes.length,
            blockers: !episodes.length ? [t("canvas.production.blocking.noOutline")] : synopsisReady < episodes.length ? [t("canvas.production.blocking.synopsisMissing", { count: episodes.length - synopsisReady })] : [],
            nextAction: { label: t("canvas.production.nextStep.generateOutline"), action: "generateOutline", disabled: !hasSetting },
            count: synopsisReady,
            total: episodes.length,
        },
        {
            stage: "script",
            done: episodes.length > 0 && scriptReady === episodes.length,
            blockers: !episodes.length ? [t("canvas.production.blocking.noOutline")] : scriptReady < episodes.length ? [t("canvas.production.blocking.scriptMissing", { count: episodes.length - scriptReady })] : [],
            nextAction: { label: t("canvas.production.nextStep.generateScript"), action: "generateScript", disabled: !episodes.length },
            count: scriptReady,
            total: episodes.length,
        },
        {
            stage: "assets",
            done: hasAssets,
            blockers: hasAssets ? [] : [t("canvas.production.blocking.noAssets")],
            nextAction: { label: t("canvas.production.nextStep.generateAssets"), action: "generateAssets", disabled: scriptReady < episodes.length },
            count: data.assets.length,
            total: 0,
        },
        {
            stage: "storyboard",
            done: episodes.length > 0 && storyboardReady === episodes.length,
            blockers: !hasAssets ? [t("canvas.production.blocking.noAssets")] : storyboardReady < episodes.length ? [t("canvas.production.blocking.storyboardMissing", { count: episodes.length - storyboardReady })] : [],
            nextAction: { label: t("canvas.production.nextStep.generateStoryboard"), action: "generateStoryboard", disabled: !hasAssets },
            count: storyboardReady,
            total: episodes.length,
        },
        {
            stage: "shots",
            done: shots.length > 0,
            blockers: shots.length ? [] : [t("canvas.production.blocking.noShots")],
            nextAction: { label: t("canvas.production.nextStep.generateShots"), action: "generateShots", disabled: storyboardReady < episodes.length },
            count: shots.length,
            total: 0,
        },
    ];
}

/** 自动选出当前阶段：第一个未完成的阶段。 */
export function currentStage(progress: StageProgress[]): ProductionStage {
    return progress.find((item) => !item.done)?.stage ?? "shots";
}
