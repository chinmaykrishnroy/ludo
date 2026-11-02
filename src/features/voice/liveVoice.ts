import captureUrl from "../../liveVoice.worklet.js?url";
import {
  LIVE_VOICE_PATH,
  LIVE_VOICE_PROTOCOL,
  LIVE_SAMPLE_RATE,
  LIVE_HEADER_BYTES,
  LIVE_MAX_PACKET_BYTES,
  LIVE_BUFFER_BYTES,
  livePacket,
  type LiveState,
  type LiveSpeaker,
} from "../../../shared/liveVoice";

const initialState = (): LiveState => ({
  connected: false,
  available: false,
  speaking: null,
  blocked: false,
  supported: null,
  transmitting: false,
});
type Sending = {
  request: number;
  stream: number;
  sequence: number;
  source: MediaStreamAudioSourceNode;
  node: AudioWorkletNode;
  result: Promise<boolean>;
  resolve: (ok: boolean) => void;
  stopped: boolean;
  successful?: boolean;
  stopPromise?: Promise<boolean>;
};

/** Owns live transport/codecs/playback for a room; never owns the microphone permission or saved notes. */
export class LiveVoiceClient {
  private ws?: WebSocket;
  private worker?: Worker;
  private context?: AudioContext;
  private initialized?: Promise<boolean>;
  private supported = false;
  private closed = false;
  private muted = false;
  private state = initialState();
  private retry?: ReturnType<typeof setTimeout>;
  private attempts = 0;
  private lastListen?: string;
  private request = 0;
  private grant?: { request: number; resolve: (stream?: number) => void };
  private sending?: Sending;
  private flush?: () => void;
  private receiving?: { stream: number; sequence: number; lastAt: number };
  private playAt = 0;
  private sources = new Set<AudioBufferSourceNode>();
  private lastMutedNotice = -Infinity;
  private speakingWatchdog?: ReturnType<typeof setTimeout>;
  readonly metrics = { encoded: 0, received: 0, played: 0, fallbacks: 0 };
  constructor(
    private change: (state: LiveState) => void,
    private onMuted: (speaker: LiveSpeaker) => void,
    private origin = location.origin,
  ) {
    this.connect();
  }
  private clearSpeaking() {
    clearTimeout(this.speakingWatchdog);
    this.speakingWatchdog = undefined;
    if (this.state.speaking) {
      this.update({ speaking: null });
    }
  }
  private setSpeaking(speaker: LiveSpeaker) {
    clearTimeout(this.speakingWatchdog);
    this.update({ speaking: speaker });
    this.speakingWatchdog = setTimeout(() => {
      this.clearSpeaking();
    }, 3500);
  }
  private touchSpeaking() {
    if (this.state.speaking) {
      clearTimeout(this.speakingWatchdog);
      this.speakingWatchdog = setTimeout(() => {
        this.clearSpeaking();
      }, 3500);
    }
  }
  private update(next: Partial<LiveState>) {
    if (this.closed) return;
    if (
      Object.entries(next).every(
        ([key, value]) => this.state[key as keyof LiveState] === value,
      )
    )
      return;
    this.state = { ...this.state, ...next };
    this.change(this.state);
  }
  private control(data: unknown) {
    if (
      this.ws?.readyState !== WebSocket.OPEN ||
      this.ws.bufferedAmount > LIVE_BUFFER_BYTES
    )
      return false;
    this.ws.send(JSON.stringify(data));
    return true;
  }
  private listen() {
    const ready = this.supported && this.context?.state === "running";
    const message = { type: "listen", ready, muted: this.muted };
    const serialized = JSON.stringify(message);
    if (serialized !== this.lastListen && this.control(message))
      this.lastListen = serialized;
    this.update({ available: ready && this.state.connected });
  }
  private connect() {
    if (this.closed) return;
    const url = new URL(LIVE_VOICE_PATH, this.origin);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const ws = (this.ws = new WebSocket(url, LIVE_VOICE_PROTOCOL));
    ws.binaryType = "arraybuffer";
    ws.onopen = () => {
      if (this.closed) return;
      this.attempts = 0;
      this.lastListen = undefined;
      this.update({ connected: true });
      this.listen();
    };
    ws.onmessage = (event) => {
      try {
        if (event.data instanceof ArrayBuffer) {
          this.receive(event.data);
          return;
        }
        const m = JSON.parse(event.data);
        if (
          m.type === "grant" &&
          this.grant &&
          m.request === this.grant.request
        ) {
          this.grant.resolve(m.ok ? m.stream : undefined);
          this.grant = undefined;
        } else if (
          m.type === "finished" &&
          this.sending &&
          m.request === this.sending.request
        ) {
          this.sending.successful = m.ok === true;
          this.sending.resolve(m.ok === true);
          if (!m.ok) void this.end(this.sending, true);
          this.update({ transmitting: false });
        } else if (m.type === "start") {
          this.stopPlayback();
          this.receiving = {
            stream: m.stream,
            sequence: m.sequence ?? 0,
            lastAt: performance.now(),
          };
          this.worker?.postMessage({ type: "decode-start", stream: m.stream });
          this.setSpeaking(m.speaker);
          if (this.muted && performance.now() - this.lastMutedNotice > 1000) {
            this.lastMutedNotice = performance.now();
            this.onMuted(m.speaker);
          }
        } else if (m.type === "end") {
          if (this.receiving && this.receiving.stream === m.stream) {
            if (this.muted || this.receiving.sequence > 0) {
              if (!this.muted)
                this.worker?.postMessage({
                  type: "decode-end",
                  stream: m.stream,
                });
              else this.control({ type: "delivered", stream: m.stream });
            }
          }
          this.clearSpeaking();
        } else if (m.type === "abort") {
          this.stopPlayback();
          this.clearSpeaking();
        }
      } catch {
        this.clearSpeaking();
        this.fail();
      }
    };
    ws.onerror = () => {
      /* onclose owns retry and fallback. */
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.interrupt();
      this.clearSpeaking();
      this.update({ connected: false, available: false, speaking: null });
      if (!this.closed)
        this.retry = setTimeout(
          () => this.connect(),
          Math.min(30000, 1000 * 2 ** Math.min(5, this.attempts++)) +
            Math.random() * 500,
        );
    };
  }
  /** Call directly from a trusted tap/key gesture, never requests microphone access. */
  unlock() {
    if (
      this.closed ||
      !window.AudioContext ||
      !window.AudioWorkletNode ||
      !window.Worker
    )
      return Promise.resolve(false);
    try {
      this.context ??= new AudioContext({
        sampleRate: LIVE_SAMPLE_RATE,
        latencyHint: "interactive",
      });
      // Must execute resume synchronously, before any await, for Safari autoplay.
      const resume = Promise.race([
        this.context.resume().catch(() => {}),
        new Promise<void>((resolve) => setTimeout(resolve, 800)),
      ]);
      if (!this.initialized) this.initialized = this.initialize();
      return Promise.race([
        Promise.all([resume, this.initialized]).then(([, ok]) => {
          this.listen();
          this.update({ blocked: !ok || this.context?.state !== "running" });
          return ok;
        }),
        new Promise<boolean>((resolve) =>
          setTimeout(() => resolve(false), 1200),
        ),
      ]).catch(() => {
        this.update({ blocked: true });
        return false;
      });
    } catch {
      return Promise.resolve(false);
    }
  }
  private async initialize() {
    const worker = (this.worker = new Worker(
      new URL("./liveVoice.codec.ts", import.meta.url),
      { type: "module" },
    ));
    this.context!.onstatechange = () => {
      this.listen();
      if (this.context?.state !== "running") this.interrupt();
    };
    try {
      const supported = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), 2000);
        worker.onerror = () => {
          clearTimeout(timer);
          resolve(false);
          this.fail();
        };
        worker.onmessage = ({ data }) => {
          if (data.type === "ready") {
            clearTimeout(timer);
            resolve(data.supported);
          } else this.codecMessage(data);
        };
        worker.postMessage({ type: "init" });
      });
      if (!supported || this.closed) {
        this.update({ supported: false });
        return false;
      }
      await Promise.race([
        this.context!.audioWorklet.addModule(captureUrl),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("AudioWorklet timeout")), 2000),
        ),
      ]);
      if (this.closed) return false;
      this.supported = true;
      this.update({ supported: true });
      return true;
    } catch {
      this.update({ supported: false });
      return false;
    }
  }
  private codecMessage(data: {
    type: string;
    bytes?: Uint8Array;
    samples?: Float32Array;
    sampleRate?: number;
    generation?: number;
    stream?: number;
  }) {
    if (this.closed) return;
    if (data.type === "error") {
      this.fail();
      return;
    }
    if (data.type === "capture-ack") {
      this.sending?.node.port.postMessage("ack");
      return;
    }
    if (data.type === "flushed") {
      this.flush?.();
      this.flush = undefined;
      return;
    }
    if (data.type === "decoded-end" && this.receiving?.stream === data.stream) {
      this.control({ type: "delivered", stream: data.stream });
      return;
    }
    if (data.type === "encoded" && data.bytes) {
      const sending = this.sending;
      if (!sending || sending.successful === false) return;
      const packet = livePacket(sending.stream, sending.sequence++, data.bytes);
      if (
        packet.byteLength > LIVE_MAX_PACKET_BYTES ||
        this.ws?.readyState !== WebSocket.OPEN ||
        this.ws.bufferedAmount > LIVE_BUFFER_BYTES
      ) {
        this.fail();
        return;
      }
      this.ws.send(packet);
      this.metrics.encoded++;
    } else if (
      data.type === "decoded" &&
      data.samples &&
      data.sampleRate &&
      data.generation === this.receiving?.stream
    ) {
      if (this.muted) return;
      const ctx = this.context;
      if (!ctx || ctx.state !== "running") {
        return;
      }
      if (this.playAt - ctx.currentTime > 1.0) {
        this.playAt = ctx.currentTime + 0.06;
      }
      if (this.sources.size >= 32) {
        return;
      }
      const buffer = ctx.createBuffer(1, data.samples.length, data.sampleRate);
      buffer.copyToChannel(new Float32Array(data.samples), 0);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      this.sources.add(source);
      source.onended = () => {
        this.sources.delete(source);
        source.disconnect();
      };
      this.playAt = Math.max(this.playAt, ctx.currentTime + 0.06);
      source.start(this.playAt);
      this.playAt += buffer.duration;
      this.metrics.played++;
    }
  }
  private receive(data: ArrayBuffer) {
    if (
      data.byteLength <= LIVE_HEADER_BYTES ||
      data.byteLength > LIVE_MAX_PACKET_BYTES ||
      !this.receiving
    )
      return;
    const header = new DataView(data),
      r = this.receiving;
    if (header.getUint32(0) !== r.stream) return;
    const seq = header.getUint32(4);
    if (seq < r.sequence) return;
    r.sequence = seq + 1;
    r.lastAt = performance.now();
    this.touchSpeaking();
    this.metrics.received++;
    if (this.muted) return;
    const bytes = data.slice(LIVE_HEADER_BYTES);
    this.worker?.postMessage(
      { type: "decode", timestamp: header.getUint32(8) * 1000, bytes },
      [bytes],
    );
  }
  async begin(stream: MediaStream) {
    if (
      this.sending ||
      this.closed ||
      !this.supported ||
      this.context?.state !== "running" ||
      !this.state.connected
    )
      return;
    const request = ++this.request;
    const granted = new Promise<number | undefined>((resolve) => {
      this.grant = { request, resolve };
    });
    if (!this.control({ type: "start", request })) {
      this.grant = undefined;
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const id = await Promise.race([
      granted,
      new Promise<number | undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), 3000);
      }),
    ]);
    clearTimeout(timer);
    if (!id || this.closed || this.context.state !== "running") {
      this.grant = undefined;
      this.control({ type: "cancel", request });
      return;
    }
    try {
      const ctx = this.context;
      const source = ctx.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(ctx, "ludo-live-capture", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      let resolve!: (ok: boolean) => void;
      const result = new Promise<boolean>((done) => {
        resolve = done;
      });
      const sending: Sending = {
        request,
        stream: id,
        sequence: 0,
        source,
        node,
        result,
        resolve,
        stopped: false,
      };
      this.sending = sending;
      this.update({ transmitting: true });
      this.worker!.postMessage({ type: "encode-start" });
      let samples = 0;
      node.port.onmessage = ({ data }) => {
        if (
          sending.stopped ||
          this.sending !== sending ||
          sending.successful === false
        )
          return;
        if (data.overflow) {
          this.fail();
          return;
        }
        this.worker!.postMessage(
          {
            type: "encode",
            samples: data.samples,
            timestamp: (samples / LIVE_SAMPLE_RATE) * 1000000,
          },
          [data.samples.buffer],
        );
        samples += data.samples.length;
      };
      node.onprocessorerror = () => this.fail();
      source.connect(node);
      node.connect(ctx.destination); // Capture worklet outputs silence.
      return { stop: (cancel = false) => this.end(sending, cancel) };
    } catch {
      this.control({ type: "cancel", request });
      this.fail();
      return;
    }
  }
  private end(sending: Sending, cancel: boolean): Promise<boolean> {
    if (sending.stopPromise) return sending.stopPromise;
    sending.stopped = true;
    sending.source.disconnect();
    sending.node.port.postMessage("stop");
    sending.node.disconnect();
    sending.node.port.onmessage = null;
    return (sending.stopPromise = (async () => {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        if (!cancel && sending.successful !== false) {
          const flushed = new Promise<void>((resolve) => {
            this.flush = resolve;
          });
          this.worker?.postMessage({ type: "encode-end" });
          const didFlush = await Promise.race([
            flushed.then(() => true),
            new Promise<false>((resolve) => {
              timeout = setTimeout(() => resolve(false), 1200);
            }),
          ]);
          clearTimeout(timeout);
          if (!didFlush) sending.successful = false;
        }
        this.control({
          type: cancel || sending.successful === false ? "cancel" : "end",
          request: sending.request,
        });
        if (cancel || sending.successful === false) return false;
        const result = await Promise.race([
          sending.result,
          new Promise<false>((resolve) => {
            timeout = setTimeout(() => resolve(false), 5000);
          }),
        ]);
        if (!result) this.control({ type: "cancel", request: sending.request });
        return result;
      } finally {
        clearTimeout(timeout);
        this.flush = undefined;
        if (this.sending === sending) this.sending = undefined;
        this.update({ transmitting: false });
      }
    })());
  }
  setMuted(muted: boolean) {
    this.muted = muted;
    if (muted) {
      const receiving = this.receiving;
      this.stopPlayback();
      this.receiving = receiving;
    }
    this.listen();
  }
  visibility() {
    if (document.hidden && this.sending) {
      void this.end(this.sending, true);
    }
    this.listen();
  }
  private stopPlayback() {
    this.receiving = undefined;
    this.clearSpeaking();
    this.worker?.postMessage({ type: "decode-stop" });
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        /* Already ended. */
      }
      source.disconnect();
    }
    this.sources.clear();
    this.playAt = 0;
  }
  private interrupt() {
    this.update({ transmitting: false });
    this.clearSpeaking();
    this.grant?.resolve(undefined);
    this.grant = undefined;
    if (this.sending) {
      this.sending.successful = false;
      this.sending.resolve(false);
      this.control({ type: "cancel", request: this.sending.request });
      void this.end(this.sending, true);
    }
    this.stopPlayback();
  }
  private fail() {
    this.metrics.fallbacks++;
    this.supported = false;
    this.update({ supported: false, blocked: true });
    this.interrupt();
    this.listen();
  }
  close() {
    this.closed = true;
    clearTimeout(this.retry);
    this.clearSpeaking();
    this.interrupt();
    this.ws?.close();
    this.worker?.terminate();
    void this.context?.close().catch(() => {});
  }
}
