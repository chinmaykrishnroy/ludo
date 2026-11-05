const DUCK = 0.18;

export function speechGain(rms: number) {
  return rms < 0.008 ? 1 : Math.min(3.2, Math.max(0.45, 0.125 / rms));
}

type VoiceChannel = {
  meter: AnalyserNode;
  samples: Float32Array<ArrayBuffer>;
  gain: GainNode;
};
type SoundChannel = {
  source: MediaElementAudioSourceNode;
  gain: GainNode;
  level: number;
};
type AudioSession = { type: string };

export class RoomAudioMixer {
  private context?: AudioContext;
  private output?: DynamicsCompressorNode;
  private voices = new Map<HTMLAudioElement, VoiceChannel>();
  private sounds = new Map<HTMLAudioElement, SoundChannel>();
  private timer?: ReturnType<typeof setInterval>;
  private ducked = false;
  private captureGeneration = 0;

  unlock() {
    try {
      if (!this.context) {
        const context = new AudioContext();
        const output = context.createDynamicsCompressor();
        output.threshold.value = -4;
        output.knee.value = 0;
        output.ratio.value = 20;
        output.attack.value = 0.003;
        output.release.value = 0.12;
        output.connect(context.destination);
        this.context = context;
        this.output = output;
      }
      this.resume();
    } catch {
      // Keep native media playback on browsers that cannot start Web Audio.
    }
    return this.context;
  }
  resume() {
    if (
      this.context &&
      this.context.state !== "running" &&
      this.context.state !== "closed"
    )
      void this.context.resume().catch(() => {});
  }
  beginCapture() {
    const generation = ++this.captureGeneration;
    const session = (navigator as Navigator & { audioSession?: AudioSession })
      .audioSession;
    const previous = session?.type;
    try {
      if (session) session.type = "play-and-record";
    } catch {
      // The browser can still manage the route automatically.
    }
    return () => {
      if (generation !== this.captureGeneration) return;
      if (session && previous && previous !== "play-and-record") {
        // Safari can keep the capture route even after the microphone tracks stop.
        try {
          session.type = "playback";
        } catch {
          // Restore the original preference even if the route reset was rejected.
        }
        try {
          session.type = previous;
        } catch {
          // Context recovery below is independent of the Audio Session API.
        }
      }
      const context = this.context;
      if (!context || context.state === "closed") return;
      if (
        (session && context.state === "running") ||
        String(context.state) === "interrupted"
      ) {
        // Restart the output while preserving the nodes attached to media elements.
        void context
          .suspend()
          .catch(() => {})
          .then(() => {
            if (
              this.context === context &&
              this.captureGeneration === generation
            )
              void context.resume().catch(() => {});
          });
      } else this.resume();
    };
  }
  prepareVoice(element: HTMLAudioElement) {
    const context = this.context;
    if (!context || context.state !== "running" || this.voices.has(element))
      return;
    const meter = context.createAnalyser();
    meter.fftSize = 1024;
    const gain = context.createGain();
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -20;
    compressor.knee.value = 18;
    compressor.ratio.value = 3.5;
    compressor.attack.value = 0.008;
    compressor.release.value = 0.15;
    try {
      context
        .createMediaElementSource(element)
        .connect(meter)
        .connect(gain)
        .connect(compressor)
        .connect(this.output!);
      this.voices.set(element, {
        meter,
        samples: new Float32Array(meter.fftSize),
        gain,
      });
    } catch {
      // A native element remains usable if routing is unavailable.
    }
  }
  voiceActivity(active: boolean) {
    if (active && !this.timer && this.voices.size) {
      this.timer = setInterval(() => {
        const time = this.context!.currentTime;
        for (const [element, channel] of this.voices) {
          if (element.paused) continue;
          channel.meter.getFloatTimeDomainData(channel.samples);
          let power = 0;
          for (const sample of channel.samples) power += sample * sample;
          channel.gain.gain.setTargetAtTime(
            speechGain(Math.sqrt(power / channel.samples.length)),
            time,
            0.12,
          );
        }
      }, 80);
    } else if (!active && this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
  setSoundLevel(element: HTMLAudioElement, level: number) {
    const context = this.context;
    if (context?.state === "running" && !this.sounds.has(element)) {
      try {
        const gain = context.createGain();
        const source = context.createMediaElementSource(element);
        source.connect(gain).connect(this.output!);
        this.sounds.set(element, { source, gain, level });
        element.volume = 1;
      } catch {
        // Native volume or pause below handles browsers without routing.
      }
    }
    const sound = this.sounds.get(element);
    const target = level * (this.ducked ? DUCK : 1);
    if (sound && context) {
      sound.level = level;
      sound.gain.gain.setTargetAtTime(
        target,
        context.currentTime,
        this.ducked ? 0.025 : 0.15,
      );
      return true;
    }
    element.volume = target;
    return Math.abs(element.volume - target) < 0.02;
  }
  duck(active: boolean) {
    this.ducked = active;
    for (const [element, sound] of this.sounds)
      this.setSoundLevel(element, sound.level);
  }
  forgetSound(element: HTMLAudioElement) {
    const channel = this.sounds.get(element);
    channel?.source.disconnect();
    channel?.gain.disconnect();
    this.sounds.delete(element);
  }
  close() {
    this.voiceActivity(false);
    this.voices.clear();
    this.sounds.clear();
    if (this.context) void this.context.close().catch(() => {});
    this.context = undefined;
    this.output = undefined;
  }
}
