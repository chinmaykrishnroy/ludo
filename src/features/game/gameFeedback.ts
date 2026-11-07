export type FeedbackKind =
  "roll" | "move" | "capture" | "finish" | "botCheer" | "botGroan" | "botTaunt";
export type Tone = {
  at: number;
  from: number;
  to: number;
  duration: number;
  gain: number;
  type: OscillatorType;
};
export const TONES: Record<FeedbackKind, Tone[]> = {
  roll: [0, 0.055, 0.11].map((at, i) => ({
    at,
    from: 440 - i * 35,
    to: 285,
    duration: 0.035,
    gain: 0.009,
    type: "triangle",
  })),
  move: [
    { at: 0, from: 330, to: 245, duration: 0.09, gain: 0.01, type: "sine" },
  ],
  capture: [
    { at: 0, from: 620, to: 710, duration: 0.07, gain: 0.01, type: "sine" },
    {
      at: 0.065,
      from: 790,
      to: 880,
      duration: 0.08,
      gain: 0.009,
      type: "sine",
    },
  ],
  finish: [
    { at: 0, from: 660, to: 790, duration: 0.09, gain: 0.011, type: "sine" },
    { at: 0.08, from: 880, to: 990, duration: 0.11, gain: 0.01, type: "sine" },
  ],
  botCheer: [
    { at: 0, from: 523, to: 659, duration: 0.06, gain: 0.008, type: "sine" },
    { at: 0.06, from: 659, to: 784, duration: 0.06, gain: 0.008, type: "sine" },
    {
      at: 0.12,
      from: 784,
      to: 1046,
      duration: 0.09,
      gain: 0.008,
      type: "sine",
    },
  ],
  botGroan: [
    {
      at: 0,
      from: 380,
      to: 310,
      duration: 0.08,
      gain: 0.008,
      type: "triangle",
    },
    { at: 0.08, from: 310, to: 220, duration: 0.1, gain: 0.008, type: "sine" },
  ],
  botTaunt: [
    { at: 0, from: 587, to: 659, duration: 0.07, gain: 0.008, type: "sine" },
    { at: 0.08, from: 784, to: 698, duration: 0.09, gain: 0.008, type: "sine" },
  ],
};
export function playGameSound(context: AudioContext, kind: FeedbackKind) {
  const tones = TONES[kind];
  if (!tones || !tones.length) return;
  const now = context.currentTime;
  for (const tone of tones) {
    const start = Math.max(now, now + tone.at);
    const stop = start + tone.duration + 0.02;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = tone.type;
    oscillator.frequency.setValueAtTime(tone.from, start);
    oscillator.frequency.exponentialRampToValueAtTime(
      tone.to,
      start + tone.duration,
    );
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(tone.gain, start + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + tone.duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.onended = () => {
      try {
        oscillator.disconnect();
        gain.disconnect();
      } catch {
        /* ignore cleanup */
      }
    };
    oscillator.start(start);
    oscillator.stop(stop);
  }
}
export function captureHaptic(
  enabled: boolean,
  visible: boolean,
  device: {
    vibrate?: (pattern: number[]) => boolean;
    userActivation?: { hasBeenActive: boolean };
  },
) {
  if (
    !enabled ||
    !visible ||
    device.userActivation?.hasBeenActive === false ||
    !device.vibrate
  )
    return false;
  try {
    return device.vibrate([20, 30, 25]);
  } catch {
    return false;
  }
}
