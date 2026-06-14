/**
 * 写作参数预设（Writing Parameter Presets）
 *
 * 快速应用文风稳定参数组合，降低用户参数调试门槛。
 * 预设场景：叙事连贯 / 描写丰富 / 对话紧凑 / 实验性创作 / 可复现调试
 */

export interface WritingParams {
  readonly temperature: string;
  readonly topP: string;
  readonly presencePenalty: string;
  readonly frequencyPenalty: string;
  readonly seed: string;
  readonly repetitionPenalty: string;
}

export interface WritingPreset {
  readonly label: string;
  readonly description: string;
  readonly params: WritingParams;
}

export const WRITING_PRESETS: ReadonlyArray<WritingPreset> = [
  {
    label: "叙事连贯",
    description: "适合章节正文生成，减少发散和重复",
    params: {
      temperature: "0.7",
      topP: "0.9",
      presencePenalty: "0.1",
      frequencyPenalty: "0.1",
      repetitionPenalty: "1.05",
      seed: "",
    },
  },
  {
    label: "描写丰富",
    description: "增加词汇多样性，适合景物/心理描写",
    params: {
      temperature: "0.85",
      topP: "0.95",
      presencePenalty: "0.2",
      frequencyPenalty: "0.2",
      repetitionPenalty: "1.1",
      seed: "",
    },
  },
  {
    label: "对话紧凑",
    description: "减少废话，适合对话场景",
    params: {
      temperature: "0.6",
      topP: "0.85",
      presencePenalty: "0.3",
      frequencyPenalty: "0.0",
      repetitionPenalty: "1.05",
      seed: "",
    },
  },
  {
    label: "实验创作",
    description: "允许更大发散，适合头脑风暴",
    params: {
      temperature: "1.0",
      topP: "0.98",
      presencePenalty: "0.0",
      frequencyPenalty: "0.0",
      repetitionPenalty: "1.0",
      seed: "",
    },
  },
  {
    label: "可复现调试",
    description: "固定 seed，方便对比 prompt 效果",
    params: {
      temperature: "0.7",
      topP: "0.9",
      presencePenalty: "0.1",
      frequencyPenalty: "0.1",
      repetitionPenalty: "1.05",
      seed: "42",
    },
  },
];

interface Props {
  readonly onApply: (params: WritingParams) => void;
}

/**
 * 写作参数预设选择器
 * 在 ServiceDetailPage 高级参数区域顶部使用，一键应用预设参数组合。
 */
export function WritingParamPresets({ onApply }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2 pb-3 border-b border-border/20 mb-2">
      <span className="text-[10px] text-muted-foreground/70 uppercase font-semibold tracking-wider self-center">
        预设
      </span>
      {WRITING_PRESETS.map((preset) => (
        <button
          key={preset.label}
          onClick={() => onApply(preset.params)}
          className="text-[10px] px-2.5 py-1 rounded-md bg-secondary/40 hover:bg-secondary/60 hover:text-foreground transition-colors border border-border/30"
          title={preset.description}
        >
          {preset.label}
        </button>
      ))}
    </div>
  );
}
