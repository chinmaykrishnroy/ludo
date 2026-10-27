import { useEffect, useState } from "react";
export default function Dice({
  value,
  rolling = false,
}: {
  value: number | null;
  rolling?: boolean;
}) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!rolling) return;
    const timer = setInterval(() => setFrame((f) => (f + 1) % 6), 75);
    return () => clearInterval(timer);
  }, [rolling]);
  const shown = rolling ? frame + 1 : value;
  const points: Record<number, number[]> = {
    1: [4],
    2: [0, 8],
    3: [0, 4, 8],
    4: [0, 2, 6, 8],
    5: [0, 2, 4, 6, 8],
    6: [0, 2, 3, 5, 6, 8],
  };
  return (
    <span
      className={`dice ${rolling ? "rolling" : ""}`}
      role="img"
      aria-label={
        rolling
          ? "Dice rolling"
          : value
            ? `Dice showing ${value}`
            : "Dice ready"
      }
    >
      {!rolling && value === null && (
        <span className="dice-ready" aria-hidden="true" />
      )}
      <span className="dice-pips">
        {Array.from({ length: 9 }, (_, i) => (
          <i
            key={i}
            className={
              (shown ? points[shown] : []).includes(i) ? "visible" : ""
            }
          />
        ))}
      </span>
    </span>
  );
}
