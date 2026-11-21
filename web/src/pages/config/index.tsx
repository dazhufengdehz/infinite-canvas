import { BookOpen } from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { AppConfigPanel } from "@/components/layout/app-config-modal";
import { PageHeader } from "@/components/ui/page-header";

export default function ConfigPage() {
    const { t } = useTranslation();

    return (
        <main className="h-full overflow-y-auto bg-background">
            <div className="mx-auto max-w-[1180px] px-8 py-8">
                <PageHeader
                    title={t("config.title")}
                    description={t("config.description")}
                    actions={
                        <Link
                            to="/guide"
                            className="inline-flex items-center gap-2 rounded-control border border-hairline bg-surface px-3 py-1.5 text-label font-medium text-ink-soft transition-colors duration-150 hover:bg-surface-hover"
                        >
                            <BookOpen className="size-3.5" />
                            <span>{t("config.viewGuide")}</span>
                        </Link>
                    }
                />
                <div className="mt-6">
                    <AppConfigPanel />
                </div>
            </div>
        </main>
    );
}
