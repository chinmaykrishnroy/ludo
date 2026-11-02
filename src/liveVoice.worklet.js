// Runs on the audio rendering thread. One 20ms mono frame per message.
class LiveCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frame = new Float32Array(960);
    this.used = 0;
    this.pending = 0;
    this.active = true;
    this.port.onmessage = ({ data }) => {
      if (data === "ack") this.pending = Math.max(0, this.pending - 1);
      if (data === "stop") this.active = false;
    };
  }
  process(inputs) {
    if (!this.active) return false;
    const channels = inputs[0];
    if (!channels?.length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      let value = 0;
      for (const c of channels) value += c[i] / channels.length;
      this.frame[this.used++] = value;
      if (this.used === this.frame.length) {
        if (++this.pending > 50) {
          this.pending = 50;
          this.frame = new Float32Array(960);
          this.used = 0;
          return true;
        }
        this.port.postMessage({ samples: this.frame }, [this.frame.buffer]);
        this.frame = new Float32Array(960);
        this.used = 0;
      }
    }
    return true;
  }
}
registerProcessor("ludo-live-capture", LiveCapture);
