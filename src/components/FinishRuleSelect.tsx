import { useState, useRef, useEffect } from "react";
import { CaretDown, Check } from "@phosphor-icons/react";

interface Option {
  value: "first" | "all";
  title: string;
  desc: string;
}

const OPTIONS: Option[] = [
  {
    value: "first",
    title: "Quick Finish",
    desc: "First to bring tokens home wins",
  },
  {
    value: "all",
    title: "Play Till End",
    desc: "1st, 2nd, and 3rd place podium",
  },
];

export function FinishRuleSelect({
  value,
  disabled,
  onChange,
}: {
  value: "first" | "all";
  disabled?: boolean;
  onChange: (val: "first" | "all") => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleDown = (e: MouseEvent | TouchEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleDown);
    document.addEventListener("touchstart", handleDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleDown);
      document.removeEventListener("touchstart", handleDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const current = OPTIONS.find((o) => o.value === value) ?? OPTIONS[0];

  return (
    <div
      ref={containerRef}
      className={`custom-select-wrap ${open ? "open" : ""} ${disabled ? "disabled" : ""}`}
    >
      <button
        type="button"
        className="custom-select-trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="custom-select-label">
          <strong className="select-lead">{current.title}</strong>
          <span className="select-sep">—</span>
          <span className="select-sub">{current.desc}</span>
        </span>
        <CaretDown
          weight="bold"
          className={`select-arrow ${open ? "arrow-up" : ""}`}
        />
      </button>

      {open && (
        <div className="custom-select-popover" role="listbox">
          {OPTIONS.map((opt) => (
            <button
              type="button"
              key={opt.value}
              role="option"
              aria-selected={opt.value === value}
              className={`custom-select-item ${opt.value === value ? "active" : ""}`}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
            >
              <div className="select-item-text">
                <span className="item-title">{opt.title}</span>
                <span className="item-desc">{opt.desc}</span>
              </div>
              {opt.value === value && (
                <Check weight="bold" className="item-check" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
