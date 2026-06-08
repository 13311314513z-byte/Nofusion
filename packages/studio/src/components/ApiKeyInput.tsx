import { useId } from "react";
import { Eye, EyeOff } from "lucide-react";

interface ApiKeyInputProps {
  readonly value: string;
  readonly visible: boolean;
  readonly onChange: (value: string) => void;
  readonly onToggleVisible: () => void;
  readonly placeholder?: string;
  readonly className?: string;
}

export function ApiKeyInput({
  value,
  visible,
  onChange,
  onToggleVisible,
  placeholder = "sk-...",
  className = "",
}: ApiKeyInputProps) {
  const inputId = useId();

  return (
    <div className="relative">
      <input
        type={visible ? "text" : "password"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        inputMode="text"
        id={inputId}
        name={`api-token-${inputId.replace(/:/g, "")}`}
        data-form-type="other"
        data-lpignore="true"
        data-1p-ignore="true"
        data-bwignore="true"
        className={[
          "w-full pr-10 font-mono",
          className,
        ].filter(Boolean).join(" ")}
      />
      <button
        type="button"
        onClick={onToggleVisible}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-muted-foreground transition-colors"
        aria-label={visible ? "Hide API key" : "Show API key"}
      >
        {visible ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </div>
  );
}
