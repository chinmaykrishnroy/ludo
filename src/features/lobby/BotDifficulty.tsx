import { memo } from "react";

export interface BotDifficultyProps {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  label?: string;
  compact?: boolean;
}

export const BotDifficulty = memo(function BotDifficulty({
  value,
  onChange,
  disabled = false,
  label = "Bot difficulty",
  compact = false,
}: BotDifficultyProps) {
  if (compact) {
    return (
      <div
        className="seat-bot-level-picker"
        title="Bot difficulty level (0–10)"
      >
        <span className="seat-bot-level-label">Lv</span>
        <select
          className="seat-bot-level-select"
          aria-label={label}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
        >
          {Array.from({ length: 11 }, (_, level) => (
            <option key={level} value={level}>
              {level}
            </option>
          ))}
        </select>
      </div>
    );
  }

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
});

export default BotDifficulty;
