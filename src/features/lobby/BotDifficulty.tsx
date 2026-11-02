export interface BotDifficultyProps {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  label?: string;
}

export function BotDifficulty({
  value,
  onChange,
  disabled = false,
  label = "Bot difficulty",
}: BotDifficultyProps) {
  return (
    <label className="field-label">
      {label}
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      >
        {Array.from({ length: 11 }, (_, level) => (
          <option key={level} value={level}>
            {level}
            {level === 0
              ? " — First legal move"
              : level === 10
                ? " — Expert"
                : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

export default BotDifficulty;
