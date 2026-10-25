export default function Dice({
  value,
  rolling = false,
}: {
  value: number;
  rolling?: boolean;
}) {
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
      aria-label={rolling ? "Dice rolling" : `Dice showing ${value}`}
    >
      <span className="dice-pips">
        {Array.from({ length: 9 }, (_, i) => (
          <i key={i} className={points[value].includes(i) ? "visible" : ""} />
        ))}
      </span>
    </span>
  );
}
