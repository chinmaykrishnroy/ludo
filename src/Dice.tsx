import { memo, useLayoutEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
const PIPS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};
const ORIENTATION: Record<number, [number, number]> = {
  1: [0, 0],
  2: [-90, 0],
  3: [0, -90],
  4: [0, 90],
  5: [90, 0],
  6: [0, 180],
};
const pose = (x: number, y: number, z = -6) =>
  `translateZ(calc(var(--dice-depth) * -1)) rotateZ(${z}deg) rotateX(${x}deg) rotateY(${y}deg)`;
type Phase = "ready" | "rolling" | "landing" | "settled";
export default memo(function Dice({
  value,
  rolling = false,
  onSettled,
}: {
  value: number | null;
  rolling?: boolean;
  onSettled?: (value: number) => void;
}) {
  const root = useRef<HTMLSpanElement>(null),
    cube = useRef<HTMLSpanElement>(null);
  const reduced = useReducedMotion();
  const notify = useRef(onSettled);
  notify.current = onSettled;
  const [phase, setPhase] = useState<Phase>(value ? "settled" : "ready");
  const orientation = useRef<[number, number]>(ORIENTATION[value ?? 1]);
  useLayoutEffect(() => {
    const element = root.current!;
    const resize = () =>
      element.style.setProperty("--dice-depth", `${element.clientWidth / 2}px`);
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const element = cube.current!;
    if (rolling) {
      setPhase("rolling");
      if (reduced) return;
      const [x, y] = orientation.current;
      // Full turns meet at the same pose. The six fixed faces never repaint pips.
      const animation = element.animate(
        [
          { transform: pose(x, y) },
          { transform: pose(x + 720, y + 1080, 354) },
        ],
        { duration: 1100, iterations: Infinity, easing: "linear" },
      );
      return () => {
        // Preserve the exact visible pose before cancelling the infinite tumble.
        element.style.transform = getComputedStyle(element).transform;
        animation.cancel();
      };
    }
    if (value === null) {
      setPhase("ready");
      orientation.current = ORIENTATION[1];
      element.style.transform = pose(0, 0);
      return;
    }
    const [x, y] = ORIENTATION[value];
    orientation.current = [x, y];
    const target = pose(x, y);
    if (reduced || phase === "ready" || phase === "settled") {
      element.style.transform = target;
      setPhase("settled");
      notify.current?.(value);
      return;
    }
    setPhase("landing");
    const animation = element.animate(
      [
        { transform: getComputedStyle(element).transform, offset: 0 },
        { transform: pose(x, y, -9), offset: 0.82 },
        { transform: target, offset: 1 },
      ],
      { duration: 280, easing: "cubic-bezier(.18,.7,.25,1)", fill: "forwards" },
    );
    animation.onfinish = () => {
      element.style.transform = target;
      animation.onfinish = null;
      animation.cancel();
      setPhase("settled");
      notify.current?.(value);
    };
    return () => {
      animation.onfinish = null;
      animation.cancel();
    };
    // Phase belongs to this animation; rerenders must not restart it.
  }, [rolling, value, reduced]);
  const moving = phase === "rolling" || phase === "landing";
  return (
    <span
      ref={root}
      className={`dice ${moving ? "rolling" : ""}`}
      data-phase={phase}
      data-reduced={!!reduced}
      role="img"
      aria-label={
        moving ? "Dice rolling" : value ? `Dice showing ${value}` : "Dice ready"
      }
    >
      <span className="dice-stage" aria-hidden="true">
        <span ref={cube} className="dice-cube">
          {[1, 2, 3, 4, 5, 6].map((face) => (
            <span
              className={`dice-face face-${face}`}
              data-face={face}
              key={face}
            >
              <span className="dice-pips">
                {Array.from({ length: 9 }, (_, i) => (
                  <i
                    key={i}
                    className={PIPS[face].includes(i) ? "visible" : ""}
                  />
                ))}
              </span>
            </span>
          ))}
        </span>
      </span>
      <span className="dice-idle" aria-hidden="true">
        <span className="dice-ready" />
      </span>
    </span>
  );
});
