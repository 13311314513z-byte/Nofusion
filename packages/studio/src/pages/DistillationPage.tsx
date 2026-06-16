/**
 * DistillationPage — displays the writer style distillation for an author.
 *
 * Uses the existing /api/v1/style/authors/:authorId/distillations/current endpoint
 * which already returns the full distillation data including rules, sentence patterns,
 * word preferences, narrative habits, and staleness detection.
 */

import { useApi } from "../hooks/use-api";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";

interface DistillationRule {
  readonly id: string;
  readonly dimension: string;
  readonly mode: string;
  readonly instruction: string;
  readonly targetRange?: { readonly min: number; readonly max: number };
  readonly confidence: number;
  readonly source: string;
  readonly enabled: boolean;
}

interface DistillationData {
  readonly authorId: string;
  readonly authorProfileVersion: number;
  readonly version: number;
  readonly isStale?: boolean;
  readonly currentAuthorProfileVersion?: number;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly rules?: ReadonlyArray<DistillationRule>;
  readonly evidenceRefs?: ReadonlyArray<string>;
  readonly warnings?: ReadonlyArray<string>;
  readonly markdown?: string;
}

interface Nav {
  toDashboard: () => void;
}

export function DistillationPage({
  authorId, nav, theme, t,
}: {
  authorId: string; nav: Nav; theme: Theme; t: TFunction;
}) {
  const c = useColors(theme);
  const { data, loading, error } = useApi<DistillationData>(
    `/style/authors/${encodeURIComponent(authorId)}/distillations/current`,
  );

  if (loading) return <div className={c.muted}>{t("common.loading")}</div>;
  if (error) {
    // 404 = no distillation yet
    if (error.includes("404") || error.includes("not found")) {
      return (
        <div className="space-y-4">
          <div className={`border ${c.cardStatic} rounded-lg p-8 text-center`}>
            <h2 className={`text-lg font-medium ${c.subtle} mb-2`}>暂无蒸馏数据</h2>
            <p className={`text-sm ${c.muted}`}>请先生成作家蒸馏档案</p>
          </div>
        </div>
      );
    }
    return <div className="text-red-400">{t("common.error")}: {error}</div>;
  }
  if (!data) return null;

  const rules = data.rules ?? [];
  const hasData = rules.length > 0;

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className={`flex items-center gap-2 text-sm ${c.muted}`}>
        <button onClick={nav.toDashboard} className={c.link}>{t("bread.books")}</button>
        <span>/</span>
        <span className={c.subtle}>作家蒸馏</span>
      </div>

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">作家蒸馏</h1>
        {data.isStale && (
          <span className="text-xs px-2 py-1 rounded bg-amber-500/20 text-amber-600">
            已过期 (v{data.authorProfileVersion} → v{data.currentAuthorProfileVersion})
          </span>
        )}
      </div>

      {!hasData ? (
        <div className={`border ${c.cardStatic} rounded-lg p-8 text-center`}>
          <p className={`text-sm ${c.muted}`}>蒸馏数据为空</p>
        </div>
      ) : (
        <>
          {/* Distillation Rules */}
          {rules.length > 0 && (
            <div className={`border ${c.cardStatic} rounded-lg p-5`}>
              <h2 className={`text-sm font-medium ${c.subtle} mb-4`}>写作规则</h2>
              <div className="space-y-3">
                {rules.map((rule) => (
                  <div key={rule.id} className="flex items-start gap-3">
                    <span className={`text-xs px-1.5 py-0.5 rounded shrink-0 ${rule.enabled ? "bg-emerald-500/20 text-emerald-600" : "bg-zinc-500/20 text-zinc-500"}`}>
                      {rule.dimension}
                    </span>
                    <span className={`text-sm ${c.subtle} flex-1`}>{rule.instruction}</span>
                    <span className={`text-[10px] ${c.muted} shrink-0`}>{rule.mode}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Version info */}
          <div className={`text-xs ${c.muted} text-right`}>
            v{data.version} · {data.updatedAt ? new Date(data.updatedAt).toLocaleDateString() : ""}
          </div>
        </>
      )}
    </div>
  );
}
