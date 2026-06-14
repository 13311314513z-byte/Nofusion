/**
 * AuthorProfileCard — Full-dimension author profile card with source links.
 */

import React from "react";
import type { AuthorStyleProfile } from "@actalk/inkos-core";
import { DimensionSamplePreview } from "./DimensionSamplePreview";
import type { DimensionSample } from "@actalk/inkos-core";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface AuthorProfileCardProps {
  readonly profile: AuthorStyleProfile;
  readonly dimensionSamples?: ReadonlyArray<DimensionSample>;
  readonly onImportAsTarget?: () => void;
  readonly onReanalyze?: () => void;
  readonly onDelete?: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRatio(v: number): string {
  return `${Math.round(v * 100)}%`;
}

function bar(v: number, max: number): string {
  const filled = Math.round((v / max) * 10);
  return "█".repeat(filled) + "░".repeat(10 - filled);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AuthorProfileCard({
  profile,
  dimensionSamples,
  onImportAsTarget,
  onReanalyze,
  onDelete,
}: AuthorProfileCardProps) {
  const fp = profile.aggregateProfile.fingerprint;
  const stats = profile.aggregateProfile;

  const hasSourceUrls = profile.sourceUrls && profile.sourceUrls.length > 0;

  return (
    <div className="space-y-4 p-4 bg-white rounded-lg border border-gray-200">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-lg font-bold text-gray-900">{profile.name}</h3>
          <div className="text-xs text-gray-500 mt-1">
            {profile.language === "zh" ? "中文" : profile.language === "en" ? "English" : profile.language}
            {profile.tags.length > 0 && ` · ${profile.tags.join("、")}`}
            {profile.sampleStats.sourceCount > 0 && ` · ${profile.sampleStats.sourceCount} 个样本`}
            {profile.sampleStats.totalChars > 0 && ` · ${profile.sampleStats.totalChars.toLocaleString()} 字`}
            {` · v${profile.version}`}
          </div>
        </div>
        <div className="flex gap-2">
          {onImportAsTarget && (
            <button
              className="text-xs px-3 py-1.5 rounded bg-blue-500 text-white hover:bg-blue-600"
              onClick={onImportAsTarget}
            >
              📥 导入为改写目标
            </button>
          )}
          {onReanalyze && (
            <button
              className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-600 hover:bg-gray-200"
              onClick={onReanalyze}
            >
              🔄 重新分析
            </button>
          )}
          {onDelete && (
            <button
              className="text-xs px-2 py-1 rounded bg-red-50 text-red-500 hover:bg-red-100"
              onClick={onDelete}
            >
              🗑 删除
            </button>
          )}
        </div>
      </div>

      {/* Style fingerprint */}
      <div>
        <h4 className="text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide">文风指纹</h4>
        <div className="space-y-1.5">
          <FingerprintRow label="对话占比" value={fp.dialogueRatio} max={1} />
          <FingerprintRow label="动作密度" value={fp.actionDensity} max={1} />
          <FingerprintRow label="心理占比" value={fp.psychologicalRatio} max={1} />
          <FingerprintRow label="感官密度" value={fp.sensoryDensity} max={1} />
          <FingerprintRow label="口语化" value={fp.colloquialismScore} max={1} />
          <FingerprintRow label="修辞密度" value={fp.rhetoricDensity} max={1} />
          <FingerprintRow label="AI腔风险" value={fp.aiTellRisk} max={1} />
        </div>
      </div>

      {/* Basic stats */}
      <div className="grid grid-cols-2 gap-2 text-xs text-gray-600">
        <div>平均句长: <strong>{stats.avgSentenceLength}</strong> 字</div>
        <div>句长标准差: <strong>{stats.sentenceLengthStdDev}</strong></div>
        <div>平均段落长度: <strong>{stats.avgParagraphLength}</strong> 字</div>
        <div>词汇多样性: <strong>{(stats.vocabularyDiversity * 100).toFixed(1)}%</strong></div>
      </div>

      {/* Rhetorical features */}
      {stats.rhetoricalFeatures.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-gray-700 mb-1 uppercase tracking-wide">修辞特征</h4>
          <div className="flex flex-wrap gap-1">
            {stats.rhetoricalFeatures.map((f, i) => (
              <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                {f}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Top patterns */}
      {stats.topPatterns.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-gray-700 mb-1 uppercase tracking-wide">主要句式模式</h4>
          <div className="space-y-0.5">
            {stats.topPatterns.map((p, i) => (
              <div key={i} className="text-xs text-gray-500">{p}</div>
            ))}
          </div>
        </div>
      )}

      {/* Dimension samples */}
      {dimensionSamples && dimensionSamples.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide">示例选段</h4>
          <DimensionSamplePreview samples={dimensionSamples} />
        </div>
      )}

      {/* Source links */}
      {hasSourceUrls && (
        <div>
          <h4 className="text-xs font-semibold text-gray-700 mb-1 uppercase tracking-wide">来源链接</h4>
          <div className="space-y-1">
            {profile.sourceUrls!.map((src, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className="text-gray-400">📄</span>
                <a
                  href={src.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline truncate"
                >
                  {src.title || src.url}
                </a>
                {src.localFilePath && (
                  <span className="text-gray-400">📁 {src.localFilePath}</span>
                )}
                <span className="text-gray-400 text-[10px]">{src.fetchedAt.slice(0, 10)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function FingerprintRow({ label, value, max }: { label: string; value: number; max: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-600 w-16 shrink-0">{label}</span>
      <span className="text-xs text-gray-300 tracking-widest">{bar(value, max)}</span>
      <span className="text-xs text-gray-500">{formatRatio(value)}</span>
    </div>
  );
}
