export type FeedbackKind = "roll" | "move" | "capture" | "finish";
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
    gain: 0.011,
    type: "triangle",
  })),
  move: [
    { at: 0, from: 330, to: 245, duration: 0.09, gain: 0.014, type: "sine" },
  ],
  capture: [
    { at: 0, from: 620, to: 710, duration: 0.08, gain: 0.014, type: "sine" },
    { at: 0.07, from: 790, to: 880, duration: 0.1, gain: 0.012, type: "sine" },
  ],
  finish: [
    { at: 0, from: 660, to: 790, duration: 0.1, gain: 0.014, type: "sine" },
    { at: 0.09, from: 880, to: 990, duration: 0.13, gain: 0.012, type: "sine" },
  ],
};
export function playGameSound(context: AudioContext, kind: FeedbackKind) {
  void context.resume().catch(() => {});
  for (const tone of TONES[kind]) {
    const start = context.currentTime + tone.at,
      oscillator = context.createOscillator(),
      gain = context.createGain();
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
      oscillator.disconnect();
      gain.disconnect();
    };
    oscillator.start(start);
    oscillator.stop(start + tone.duration + 0.01);
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
