import type { Rng } from "./types.js";
export function createRng(seed: number | string): Rng {
  let state = 2166136261;
  for (const ch of String(seed))
    state = Math.imul(state ^ ch.charCodeAt(0), 16777619) >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const sampleDie = (rng: Rng) => Math.min(6, Math.floor(rng() * 6) + 1);
