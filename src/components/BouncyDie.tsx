import React, { useEffect, useState, useRef, useCallback } from "react";

export interface BouncyDieProps {
  value?: number;
  isRolling?: boolean;
  color?: string; // Die background color
  pipColor?: string; // Pip color
  size?: number; // Size in px
  className?: string;
  interactive?: boolean;
  syncGlobal?: boolean;
  onRoll?: (value: number) => void;
  style?: React.CSSProperties;
}

const PIPS_MAP: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

export const BouncyDie: React.FC<BouncyDieProps> = ({
  value = 5,
  isRolling: controlledRolling,
  color,
  pipColor,
  size = 28,
  className = "",
  interactive = false,
  syncGlobal = false,
  onRoll,
  style,
}) => {
  const [currentVal, setCurrentVal] = useState<number>(value);
  const [internalRolling, setInternalRolling] = useState(false);
  const [displayFace, setDisplayFace] = useState<number>(value);
  const rollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cycleIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const rolling = controlledRolling ?? internalRolling;

  // Sync value changes
  useEffect(() => {
    if (!rolling) {
      setCurrentVal(value);
      setDisplayFace(value);
    }
  }, [value, rolling]);

  // Handle rolling animation and rapid pip shuffle
  useEffect(() => {
    if (rolling) {
      // Rapid shuffle
      cycleIntervalRef.current = setInterval(() => {
        setDisplayFace(Math.floor(Math.random() * 6) + 1);
      }, 50);
    } else {
      if (cycleIntervalRef.current) {
        clearInterval(cycleIntervalRef.current);
        cycleIntervalRef.current = null;
      }
      setDisplayFace(currentVal);
    }

    return () => {
      if (cycleIntervalRef.current) {
        clearInterval(cycleIntervalRef.current);
      }
    };
  }, [rolling, currentVal]);

  // Global sync listener
  useEffect(() => {
    if (!syncGlobal) return;

    const handleGlobalRoll = (e: Event) => {
      const customEvent = e as CustomEvent<{ value: number }>;
      const nextVal =
        customEvent.detail?.value ?? Math.floor(Math.random() * 6) + 1;
      setCurrentVal(nextVal);
      setInternalRolling(true);
      if (rollTimerRef.current) clearTimeout(rollTimerRef.current);
      rollTimerRef.current = setTimeout(() => {
        setInternalRolling(false);
      }, 550);
    };

    window.addEventListener("ludo:dice-roll", handleGlobalRoll);
    return () => {
      window.removeEventListener("ludo:dice-roll", handleGlobalRoll);
    };
  }, [syncGlobal]);

  const handleClick = useCallback(() => {
    if (!interactive || rolling) return;

    const nextVal = Math.floor(Math.random() * 6) + 1;
    setCurrentVal(nextVal);
    setInternalRolling(true);

    // Dispatch global event for favicon and sync
    window.dispatchEvent(
      new CustomEvent("ludo:dice-roll", { detail: { value: nextVal } }),
    );

    if (onRoll) onRoll(nextVal);

    if (rollTimerRef.current) clearTimeout(rollTimerRef.current);
    rollTimerRef.current = setTimeout(() => {
      setInternalRolling(false);
    }, 550);
  }, [interactive, rolling, onRoll]);

  const activePips = PIPS_MAP[displayFace] || PIPS_MAP[1];

  return (
    <div
      className={`bouncy-die-wrapper ${rolling ? "is-rolling" : ""} ${interactive ? "is-interactive" : ""} ${className}`}
      style={
        {
          "--die-size": `${size}px`,
          "--die-bg": color || "var(--die-color, #f59e0b)",
          "--pip-color": pipColor || "#ffffff",
          width: size,
          height: size,
          ...style,
        } as React.CSSProperties
      }
      onClick={interactive ? handleClick : undefined}
      title={interactive ? "Click to roll the dice!" : `Rolled ${displayFace}`}
      role={interactive ? "button" : "img"}
      aria-label={`Die showing ${displayFace}`}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleClick();
              }
            }
          : undefined
      }
    >
      <div className="bouncy-die-shadow" />
      <div className="bouncy-die">
        <div className="bouncy-die-sheen" />
        <div className="bouncy-die-pips">
          {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((idx) => (
            <span
              key={idx}
              className={`bouncy-die-pip ${activePips.includes(idx) ? "active" : ""}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export default BouncyDie;
