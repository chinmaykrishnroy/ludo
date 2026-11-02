import {
  LIVE_BITRATE,
  LIVE_SAMPLE_RATE,
  LIVE_FRAME_SAMPLES,
} from "../../../shared/liveVoice";

const scope = self as unknown as {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};
const encoderConfig: AudioEncoderConfig = {
  codec: "opus",
  sampleRate: LIVE_SAMPLE_RATE,
  numberOfChannels: 1,
  bitrate: LIVE_BITRATE,
  bitrateMode: "constant",
  opus: { frameDuration: 20000 },
};
const decoderConfig: AudioDecoderConfig = {
  codec: "opus",
  sampleRate: LIVE_SAMPLE_RATE,
  numberOfChannels: 1,
};
let encoder: AudioEncoder | undefined, decoder: AudioDecoder | undefined;
let encodeGeneration = 0,
  decodeGeneration = 0;
const error = () => scope.postMessage({ type: "error" });
scope.onmessage = ({ data }) => {
  void (async () => {
    switch (data.type) {
      case "init": {
        const supported =
          typeof AudioEncoder !== "undefined" &&
          typeof AudioDecoder !== "undefined" &&
          (await AudioEncoder.isConfigSupported(encoderConfig)).supported &&
          (await AudioDecoder.isConfigSupported(decoderConfig)).supported;
        scope.postMessage({ type: "ready", supported: !!supported });
        break;
      }
      case "encode-start": {
        const generation = ++encodeGeneration;
        if (encoder?.state !== "closed") encoder?.close();
        encoder = new AudioEncoder({
          error,
          output: (chunk) => {
            if (generation !== encodeGeneration) return;
            const bytes = new Uint8Array(chunk.byteLength);
            chunk.copyTo(bytes);
            scope.postMessage({ type: "encoded", bytes }, [bytes.buffer]);
          },
        });
        encoder.configure(encoderConfig);
        break;
      }
      case "encode": {
        if (!encoder || encoder.state !== "configured") break;
        if (encoder.encodeQueueSize > 8) {
          error();
          break;
        }
        const audio = new AudioData({
          format: "f32",
          sampleRate: LIVE_SAMPLE_RATE,
          numberOfChannels: 1,
          numberOfFrames: LIVE_FRAME_SAMPLES,
          timestamp: data.timestamp,
          data: data.samples,
        });
        try {
          encoder.encode(audio);
        } finally {
          audio.close();
        }
        scope.postMessage({ type: "capture-ack" });
        break;
      }
      case "encode-end": {
        const generation = encodeGeneration;
        if (encoder?.state === "configured") await encoder.flush();
        if (generation === encodeGeneration)
          scope.postMessage({ type: "flushed" });
        break;
      }
      case "decode-start": {
        const generation = ++decodeGeneration;
        if (decoder?.state !== "closed") decoder?.close();
        decoder = new AudioDecoder({
          error,
          output: (audio) => {
            try {
              if (generation !== decodeGeneration) return;
              const samples = new Float32Array(audio.numberOfFrames);
              audio.copyTo(samples, { planeIndex: 0, format: "f32-planar" });
              scope.postMessage(
                {
                  type: "decoded",
                  generation: data.stream,
                  samples,
                  sampleRate: audio.sampleRate,
                },
                [samples.buffer],
              );
            } finally {
              audio.close();
            }
          },
        });
        decoder.configure(decoderConfig);
        break;
      }
      case "decode": {
        if (!decoder || decoder.state !== "configured") break;
        if (decoder.decodeQueueSize > 8) {
          error();
          break;
        }
        decoder.decode(
          new EncodedAudioChunk({
            type: "key",
            timestamp: data.timestamp,
            duration: 20000,
            data: data.bytes,
          }),
        );
        break;
      }
      case "decode-stop":
        ++decodeGeneration;
        if (decoder?.state !== "closed") decoder?.close();
        decoder = undefined;
        break;
      case "decode-end": {
        const generation = decodeGeneration;
        if (decoder?.state === "configured") await decoder.flush();
        if (generation === decodeGeneration)
          scope.postMessage({ type: "decoded-end", stream: data.stream });
        break;
      }
    }
  })().catch(error);
};
