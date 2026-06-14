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

interface DistillationData {
  readonly id?: string;
  readonly authorId: string;
  readonly version: number;
  readonly authorProfileVersion: number;
  readonly isStale?: boolean;
  readonly currentAuthorProfileVersion?: number;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly rules?: ReadonlyArray<string>;
  readonly sentencePatterns?: ReadonlyArray<{
    readonly pattern: string;
    readonly frequency: number;
    readonly examples?: ReadonlyArray<string>;
  }>;
  readonly wordPreferences?: ReadonlyArray<{
    readonly word: string;
    readonly category: string;
    readonly frequency: number;
  }>;
  readonly narrativeHabits?: ReadonlyArray<{
    readonly habit: string;
    readonly description: string;
  }>;
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
  const patterns = data.sentencePatterns ?? [];
  const words = data.wordPreferences ?? [];
  const habits = data.narrativeHabits ?? [];
  const hasData = rules.length > 0 || patterns.length > 0 || words.length > 0 || habits.length > 0;

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
          {/* Sentence Patterns */}
          {patterns.length > 0 && (
            <div className={`border ${c.cardStatic} rounded-lg p-5`}>
              <h2 className={`text-sm font-medium ${c.subtle} mb-4`}>句式特征</h2>
              <div className="space-y-3">
                {patterns.map((p, i) => (
                  <div key={i}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className={c.subtle}>{p.pattern}</span>
                      <span className={c.muted}>{p.frequency}次</span>
                    </div>
                    {p.examples && p.examples.length > 0 && (
                      <div className={`text-xs ${c.muted} pl-2 border-l-2 ${c.btnSecondary}`}>
                        {p.examples.slice(0, 2).map((ex, j) => (
                          <div key={j} className="truncate">{ex}</div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Word Preferences */}
          {words.length > 0 && (
            <div className={`border ${c.cardStatic} rounded-lg p-5`}>
              <h2 className={`text-sm font-medium ${c.subtle} mb-4`}>用词偏好</h2>
              <div className="flex flex-wrap gap-2">
                {words.map((w, i) => (
                  <span key={i} className={`text-xs px-2 py-1 rounded ${c.btnSecondary}`}>
                    {w.word}
                    <span className={`ml-1 ${c.muted}`}>({w.category} · {w.frequency})</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Narrative Habits */}
          {habits.length > 0 && (
            <div className={`border ${c.cardStatic} rounded-lg p-5`}>
              <h2 className={`text-sm font-medium ${c.subtle} mb-4`}>叙事习惯</h2>
              <div className="space-y-2">
                {habits.map((h, i) => (
                  <div key={i} className={`text-sm ${c.subtle}`}>
                    <span className="font-medium">{h.habit}</span>
                    <span className={`ml-2 ${c.muted}`}>{h.description}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Writing Rules */}
          {rules.length > 0 && (
            <div className={`border ${c.cardStatic} rounded-lg p-5`}>
              <h2 className={`text-sm font-medium ${c.subtle} mb-4`}>写作规则</h2>
              <ul className="space-y-1">
                {rules.map((rule, i) => (
                  <li key={i} className={`text-sm ${c.subtle} flex gap-2`}>
                    <span className={c.muted}>{i + 1}.</span>
                    <span>{rule}</span>
                  </li>
                ))}
              </ul>
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
