// Versioned, room-local Opus datagrams carried by a dedicated WebSocket.
export const LIVE_VOICE_PATH = "/live-voice";
export const LIVE_VOICE_PROTOCOL = "ludo-voice-v1";
export const LIVE_SAMPLE_RATE = 48000;
export const LIVE_FRAME_MS = 20;
export const LIVE_FRAME_SAMPLES = 960;
export const LIVE_BITRATE = 24000;
export const LIVE_HEADER_BYTES = 12;
export const LIVE_MAX_PACKET_BYTES = 512;
export const LIVE_BUFFER_BYTES = 1024;
export const LIVE_MAX_SECONDS = 60;
export type LiveSpeaker = { id: string; name: string; color: string };
export type LiveState = {
  connected: boolean;
  available: boolean;
  speaking: LiveSpeaker | null;
  blocked: boolean;
  supported: boolean | null;
  transmitting: boolean;
};
export function livePacket(stream: number, sequence: number, opus: Uint8Array) {
  const packet = new Uint8Array(LIVE_HEADER_BYTES + opus.byteLength);
  const header = new DataView(packet.buffer);
  header.setUint32(0, stream);
  header.setUint32(4, sequence);
  header.setUint32(8, sequence * LIVE_FRAME_MS);
  packet.set(opus, LIVE_HEADER_BYTES);
  return packet;
}
