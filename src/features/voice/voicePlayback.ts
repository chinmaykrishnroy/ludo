import { VOICE_MAX_SECONDS } from "../../../shared/voice";

/** Reuse the element a listener unlocks on iOS; never lose a blocked recording. */
class PlaybackChannel {
  private audio: HTMLAudioElement | null = null;
  private queue: string[] = [];
  private current: string | null = null;
  private blocked = false;
  private muted = false;
  private generation = 0;
  private unlockUrl: string | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(
    private change: (playing: string | null, blocked: boolean) => void,
    private error: () => void,
    private create = () => new Audio(),
  ) {}
  get occupied() {
    return !!this.current || this.queue.length > 0;
  }
  private element() {
    return (this.audio ??= this.create());
  }
  private pause() {
    this.generation++;
    clearTimeout(this.timer);
    if (this.audio) {
      this.audio.onended = null;
      this.audio.onerror = null;
      this.audio.onpause = null;
      this.audio.onwaiting = null;
      this.audio.onplaying = null;
      this.audio.pause();
    }
    this.current = null;
    if (this.unlockUrl) {
      URL.revokeObjectURL(this.unlockUrl);
      this.unlockUrl = undefined;
    }
  }
  clear() {
    this.pause();
    this.queue = [];
    this.blocked = false;
    this.change(null, false);
  }
  setMuted(muted: boolean) {
    this.muted = muted;
    if (muted) this.clear();
  }
  available(ids: Set<string>) {
    this.queue = this.queue.filter((id) => ids.has(id));
    if (this.current && !ids.has(this.current)) {
      this.pause();
      this.next();
    }
    if (this.blocked && !this.queue.length) {
      this.blocked = false;
      this.change(null, false);
    }
  }
  enqueue(ids: string[]) {
    if (this.muted) return;
    this.queue.push(
      ...ids.filter((id) => id !== this.current && !this.queue.includes(id)),
    );
    this.queue = this.queue.slice(-20);
    if (!this.current && !this.blocked) this.next();
  }
  toggle(id: string) {
    if (this.muted) return;
    if (this.current === id) {
      this.next();
      return;
    }
    this.pause();
    this.queue = [id, ...this.queue.filter((queued) => queued !== id)].slice(
      0,
      20,
    );
    this.blocked = false;
    this.next();
  }
  resume() {
    if (this.muted) return;
    this.blocked = false;
    if (this.queue.length) {
      this.next();
      return;
    }
    if (this.current) return;
    // A short silent WAV primes this same element during the user's gesture.
    this.pause();
    const a = this.element();
    const bytes = Uint8Array.from(
      atob("UklGRiYAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQIAAAAAAA=="),
      (c) => c.charCodeAt(0),
    );
    this.unlockUrl = URL.createObjectURL(
      new Blob([bytes], { type: "audio/wav" }),
    );
    a.src = this.unlockUrl;
    void a.play().catch(() => {});
  }
  private next() {
    this.pause();
    const id = this.muted ? undefined : this.queue.shift();
    if (!id) {
      this.change(null, this.blocked);
      return;
    }
    const a = this.element(),
      generation = this.generation;
    this.current = id;
    a.src = `/api/voice/${id}`;
    this.change(null, false);
    const playing = (value: string | null) => {
      if (generation === this.generation) this.change(value, false);
    };
    a.onpause = a.onwaiting = () => playing(null);
    a.onplaying = () => playing(id);
    a.onended = () => {
      if (generation === this.generation) this.next();
    };
    a.onerror = () => {
      if (generation === this.generation) {
        this.error();
        this.next();
      }
    };
    this.timer = setTimeout(() => {
      this.error();
      this.next();
    }, 12000);
    // Called synchronously by manual playback, inside the trusted tap gesture.
    void a
      .play()
      .then(() => {
        if (generation === this.generation) {
          playing(id);
          clearTimeout(this.timer);
          this.timer = setTimeout(
            () => this.next(),
            (VOICE_MAX_SECONDS + 0.5) * 1000,
          );
        }
      })
      .catch((error: unknown) => {
        if (generation !== this.generation) return;
        this.pause();
        if (error instanceof Error && error.name !== "NotAllowedError") {
          this.error();
          this.next();
          return;
        }
        this.queue.unshift(id);
        this.blocked = true;
        this.change(null, true);
      });
  }
}

type Clip = { id: string; speaker: string };

/** One reusable audio element per simultaneous speaker, with a queue per speaker. */
export class VoicePlayback {
  private muted = false;
  private slots: {
    speaker: string | undefined;
    playing: string | null;
    blocked: boolean;
    channel: PlaybackChannel;
  }[];

  constructor(
    change: (playing: string[], blocked: boolean) => void,
    error: () => void,
    create?: () => HTMLAudioElement,
  ) {
    this.slots = Array.from({ length: 4 }, (_, index) => ({
      speaker: undefined,
      playing: null,
      blocked: false,
      channel: new PlaybackChannel(
        (playing, blocked) => {
          const slot = this.slots[index];
          slot.playing = playing;
          slot.blocked = blocked;
          change(
            this.slots.flatMap((s) => (s.playing ? [s.playing] : [])),
            this.slots.some((s) => s.blocked),
          );
        },
        error,
        create,
      ),
    }));
  }

  private channel(speaker: string) {
    if (this.muted) return;
    const slot =
      this.slots.find((s) => s.speaker === speaker) ??
      this.slots.find((s) => !s.channel.occupied);
    if (!slot) return;
    slot.speaker = speaker;
    return slot.channel;
  }
  enqueue(clips: Clip[]) {
    for (const clip of clips) this.channel(clip.speaker)?.enqueue([clip.id]);
  }
  toggle(clip: Clip) {
    this.channel(clip.speaker)?.toggle(clip.id);
  }
  resume() {
    if (!this.muted) for (const slot of this.slots) slot.channel.resume();
  }
  clear() {
    for (const slot of this.slots) {
      slot.channel.clear();
      slot.speaker = undefined;
    }
  }
  setMuted(muted: boolean) {
    this.muted = muted;
    for (const slot of this.slots) slot.channel.setMuted(muted);
  }
  available(ids: Set<string>) {
    for (const slot of this.slots) slot.channel.available(ids);
  }
}
