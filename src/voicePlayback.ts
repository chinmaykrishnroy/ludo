import { VOICE_MAX_SECONDS } from "../shared/voice";

/** Reuse the element a listener unlocks on iOS; never lose a blocked recording. */
export class VoicePlayback {
  private audio: HTMLAudioElement | null = null;
  private queue: string[] = [];
  private current: string | null = null;
  private blocked = false;
  private muted = false;
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(
    private change: (playing: string | null, blocked: boolean) => void,
    private error: () => void,
    private create = () => new Audio(),
  ) {}
  private element() {
    return (this.audio ??= this.create());
  }
  private pause() {
    this.generation++;
    clearTimeout(this.timer);
    if (this.audio) {
      this.audio.onended = null;
      this.audio.onerror = null;
      this.audio.pause();
    }
    this.current = null;
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
      this.clear();
      return;
    }
    this.pause();
    this.queue = [id];
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
    const a = this.element();
    a.src =
      "data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQIAAAAAAA==";
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
    this.change(id, false);
    a.onended = () => {
      if (generation === this.generation) this.next();
    };
    a.onerror = () => {
      if (generation === this.generation) {
        this.error();
        this.next();
      }
    };
    // Called synchronously by manual playback, inside the trusted tap gesture.
    void a
      .play()
      .then(() => {
        if (generation === this.generation)
          this.timer = setTimeout(
            () => this.next(),
            (VOICE_MAX_SECONDS + 0.5) * 1000,
          );
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
