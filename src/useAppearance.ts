import { useEffect, useLayoutEffect, useState } from "react";

export type Appearance = "system" | "light" | "dark";

export function useAppearance() {
  const [appearance, setAppearance] = useState<Appearance>(() => {
    const saved = localStorage.getItem("ludo-appearance");
    return saved === "light" || saved === "dark" ? saved : "system";
  });
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const changed = (event: MediaQueryListEvent) =>
      setSystemDark(event.matches);
    media.addEventListener("change", changed);
    return () => media.removeEventListener("change", changed);
  }, []);
  useLayoutEffect(() => {
    document.documentElement.dataset.theme =
      appearance === "system" ? (systemDark ? "dark" : "light") : appearance;
    localStorage.setItem("ludo-appearance", appearance);
  }, [appearance, systemDark]);
  return [appearance, setAppearance] as const;
}
