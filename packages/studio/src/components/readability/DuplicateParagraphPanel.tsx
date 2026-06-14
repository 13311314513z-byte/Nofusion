/**
 * DuplicateParagraphPanel — Panel for reviewing and resolving duplicate/similar paragraphs.
 *
 * Shared component used by StyleManager, ImportManager, and AuditView.
 * Displays groups of exact duplicates and near-duplicates, with actions to delete or merge.
 */

import React, { useState, useCallback } from "react";
import type { DuplicateParagraphGroup, SimilarParagraphGroup } from "@actalk/inkos-core";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface DuplicateParagraphPanelProps {
  readonly duplicateGroups: ReadonlyArray<DuplicateParagraphGroup>;
  readonly similarGroups: ReadonlyArray<SimilarParagraphGroup>;
  readonly readonly?: boolean;
  readonly onDelete?: (paragraphIds: ReadonlyArray<number>) => void;
  readonly onMerge?: (group: SimilarParagraphGroup, mergedText: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DuplicateParagraphPanel({
  duplicateGroups,
  similarGroups,
  readonly = false,
  onDelete,
  onMerge,
}: DuplicateParagraphPanelProps) {
  return (
    <div className="space-y-4 p-4 bg-white rounded-lg border border-gray-200">
      <h3 className="text-sm font-semibold text-gray-800">
        段落去重 ({duplicateGroups.length + similarGroups.length} 组)
      </h3>

      {duplicateGroups.length === 0 && similarGroups.length === 0 && (
        <div className="text-center text-gray-400 py-8">
          未发现重复段落
        </div>
      )}

      {/* Exact duplicates */}
      {duplicateGroups.map((group, gi) => (
        <DuplicateGroupCard
          key={`dup-${group.hash}`}
          group={group}
          readonly={readonly}
          onDelete={onDelete ? () => {
            const allLines = [group.lineNumber, ...group.duplicates.map((d) => d.lineNumber)];
            onDelete(allLines.slice(1)); // Keep the first occurrence
          } : undefined}
        />
      ))}

      {/* Similar paragraphs */}
      {similarGroups.map((group, gi) => (
        <SimilarGroupCard
          key={`sim-${gi}`}
          group={group}
          readonly={readonly}
          onMerge={onMerge ? (mergedText: string) => onMerge(group, mergedText) : undefined}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface DuplicateGroupCardProps {
  readonly group: DuplicateParagraphGroup;
  readonly readonly?: boolean;
  readonly onDelete?: () => void;
}

function DuplicateGroupCard({ group, readonly, onDelete }: DuplicateGroupCardProps) {
  const [deleted, setDeleted] = useState(false);

  const handleDelete = useCallback(() => {
    setDeleted(true);
    onDelete?.();
  }, [onDelete]);

  if (deleted) return null;

  return (
    <div className="p-3 rounded border border-red-100 bg-red-50/50">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-red-700">
          完全重复 — 第 {group.lineNumber} 行
        </span>
        {!readonly && onDelete && (
          <button
            className="text-xs px-2 py-0.5 rounded bg-red-100 text-red-600 hover:bg-red-200"
            onClick={handleDelete}
          >
            删除重复
          </button>
        )}
      </div>
      <div className="text-xs text-gray-600 bg-white rounded p-2 border border-gray-100 mb-2">
        {group.content.length > 100 ? group.content.slice(0, 100) + "…" : group.content}
      </div>
      <div className="text-xs text-gray-400">
        重复位置: 第 {group.duplicates.map((d) => d.lineNumber).join("、")} 行
      </div>
    </div>
  );
}

interface SimilarGroupCardProps {
  readonly group: SimilarParagraphGroup;
  readonly readonly?: boolean;
  readonly onMerge?: (mergedText: string) => void;
}

function SimilarGroupCard({ group, readonly, onMerge }: SimilarGroupCardProps) {
  const [showMerge, setShowMerge] = useState(false);
  const [mergedText, setMergedText] = useState("");

  const handleMerge = useCallback(() => {
    if (!mergedText.trim()) return;
    onMerge?.(mergedText);
    setShowMerge(false);
  }, [mergedText, onMerge]);

  const autoMerge = useCallback(() => {
    // Simple merge: take the longest paragraph
    const sorted = [...group.paragraphs].sort((a, b) => b.content.length - a.content.length);
    setMergedText(sorted[0].content);
    setShowMerge(true);
  }, [group]);

  return (
    <div className="p-3 rounded border border-orange-100 bg-orange-50/50">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-orange-700">
          语义相似 — 相似度 {Math.round(group.similarity * 100)}%
        </span>
        {!readonly && onMerge && (
          <div className="flex gap-2">
            <button
              className="text-xs px-2 py-0.5 rounded bg-orange-100 text-orange-600 hover:bg-orange-200"
              onClick={autoMerge}
            >
              合并
            </button>
          </div>
        )}
      </div>

      {group.paragraphs.map((p, i) => (
        <div key={i} className="text-xs text-gray-600 bg-white rounded p-2 border border-gray-100 mb-1">
          <span className="text-gray-400">L{p.lineNumber}: </span>
          {p.content.length > 80 ? p.content.slice(0, 80) + "…" : p.content}
        </div>
      ))}

      {showMerge && onMerge && (
        <div className="mt-2 space-y-2">
          <textarea
            className="w-full text-xs p-2 border border-gray-200 rounded"
            rows={3}
            value={mergedText}
            onChange={(e) => setMergedText(e.target.value)}
          />
          <div className="flex gap-2">
            <button
              className="text-xs px-2 py-0.5 rounded bg-green-100 text-green-600 hover:bg-green-200"
              onClick={handleMerge}
            >
              确认合并
            </button>
            <button
              className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-500 hover:bg-gray-200"
              onClick={() => setShowMerge(false)}
            >
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
