import { App, Button, Input, Modal, Switch, Tag } from "antd";
import { FilePenLine, Plus, Sparkles, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { buildCreativeRulePrompt, useCreativeRuleStore, type CreativeRule } from "@/stores/use-creative-rule-store";

/**
 * 创作规则管理：Skill 式规则卡 + 启用开关。
 * 启用的规则会作为项目级创作规则注入生产工作台的 Agent 系统提示词，对所有阶段生效。
 */
export function ConfigCreativeRules() {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const rules = useCreativeRuleStore((state) => state.rules);
    const addRule = useCreativeRuleStore((state) => state.addRule);
    const saveRule = useCreativeRuleStore((state) => state.saveRule);
    const removeRule = useCreativeRuleStore((state) => state.removeRule);
    const toggleRule = useCreativeRuleStore((state) => state.toggleRule);
    const [editing, setEditing] = useState<CreativeRule | null>(null);
    const [name, setName] = useState("");
    const [content, setContent] = useState("");
    const [saving, setSaving] = useState(false);

    const openEdit = (rule: CreativeRule) => {
        setEditing(rule);
        setName(rule.name);
        setContent(rule.content);
    };

    const openCreate = () => {
        const rule = addRule();
        setEditing(rule);
        setName("");
        setContent("");
    };

    const handleSave = () => {
        if (!editing) return;
        if (!content.trim()) {
            message.warning(t("config.creativeRules.contentRequired"));
            return;
        }
        saveRule({ ...editing, name: name.trim(), content: content.trim() });
        setEditing(null);
        message.success(t("config.creativeRules.saved"));
    };

    const handleRemove = (rule: CreativeRule) => {
        removeRule(rule.id);
        setEditing(null);
        message.success(t("config.creativeRules.deleted"));
    };

    const activeCount = rules.filter((rule) => rule.enabled).length;
    const preview = buildCreativeRulePrompt(rules);

    return (
        <div>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs text-stone-500">{t("config.creativeRules.description", { count: activeCount })}</div>
                <Button type="primary" icon={<Plus className="size-4" />} onClick={openCreate}>
                    {t("config.creativeRules.add")}
                </Button>
            </div>

            <div className="space-y-2">
                {rules.map((rule) => (
                    <div key={rule.id} className={`flex flex-wrap items-center gap-3 rounded-lg border border-stone-200 px-4 py-3 dark:border-stone-800 ${rule.enabled ? "" : "opacity-55"}`}>
                        <Switch size="small" checked={rule.enabled} onChange={(checked) => toggleRule(rule.id, checked)} />
                        <div className="min-w-[200px] flex-1">
                            <div className="flex min-w-0 items-center gap-2">
                                <span className="truncate text-sm font-semibold">{rule.name || t("config.creativeRules.unnamed")}</span>
                                {rule.id.startsWith("builtin-") ? <Tag className="m-0 shrink-0 text-[10px]">{t("config.creativeRules.builtIn")}</Tag> : null}
                            </div>
                            <div className="mt-1 line-clamp-2 text-xs leading-5 text-stone-500">{rule.content || t("config.creativeRules.emptyContent")}</div>
                        </div>
                        <div className="ml-auto flex shrink-0 gap-2">
                            <Button size="small" icon={<FilePenLine className="size-3.5" />} onClick={() => openEdit(rule)}>
                                {t("common.edit")}
                            </Button>
                            <Button size="small" danger icon={<Trash2 className="size-3.5" />} onClick={() => handleRemove(rule)}>
                                {t("common.delete")}
                            </Button>
                        </div>
                    </div>
                ))}
            </div>

            <section className="mt-5 rounded-lg border border-stone-200 p-4 dark:border-stone-800">
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                    <Sparkles className="size-4" />
                    {t("config.creativeRules.previewTitle")}
                </div>
                <div className="mb-2 text-xs text-stone-500">{t("config.creativeRules.previewDescription")}</div>
                <pre className="thin-scrollbar max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-stone-50 p-3 text-[11px] leading-5 text-stone-600 dark:bg-stone-900/40 dark:text-stone-300">{preview || t("config.creativeRules.previewEmpty")}</pre>
            </section>

            <Modal
                title={editing?.name || t("config.creativeRules.add")}
                open={Boolean(editing)}
                okText={t("common.save")}
                cancelText={t("common.cancel")}
                confirmLoading={saving}
                width={680}
                centered
                destroyOnHidden
                onCancel={() => setEditing(null)}
                onOk={() => handleSave()}
            >
                <div className="space-y-4 pt-2">
                    <div>
                        <div className="mb-1 text-xs font-medium">{t("config.creativeRules.nameLabel")}</div>
                        <Input value={name} maxLength={64} placeholder={t("config.creativeRules.namePlaceholder")} onChange={(event) => setName(event.target.value)} />
                    </div>
                    <div>
                        <div className="mb-1 text-xs font-medium">{t("config.creativeRules.contentLabel")}</div>
                        <div className="mb-2 text-xs text-stone-500">{t("config.creativeRules.contentHint")}</div>
                        <Input.TextArea value={content} autoSize={{ minRows: 8, maxRows: 18 }} placeholder={t("config.creativeRules.contentPlaceholder")} onChange={(event) => setContent(event.target.value)} />
                    </div>
                </div>
            </Modal>
        </div>
    );
}
