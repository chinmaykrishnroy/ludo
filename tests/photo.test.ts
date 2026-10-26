import { test } from "node:test";
import assert from "node:assert/strict";
import { fitPhoto, jpegDimensions } from "../shared/photo.js";
// A frame-header fixture exercises parsing; real encoders/decoders are covered in browsers.
const header = (width: number, height: number) =>
  Uint8Array.from([
    0xff,
    0xd8,
    0xff,
    0xc0,
    0,
    11,
    8,
    height >> 8,
    height & 255,
    width >> 8,
    width & 255,
    1,
    1,
    0x11,
    0,
    0xff,
    0xda,
    0,
    8,
    1,
    1,
    0,
    0,
    63,
    0,
    0,
    0xff,
    0xd9,
  ]);
test("photos preserve aspect ratio, cap their longest edge and never upscale", () => {
  assert.deepEqual(fitPhoto(4000, 3000), { width: 1080, height: 810 });
  assert.deepEqual(fitPhoto(3000, 4000), { width: 810, height: 1080 });
  assert.deepEqual(fitPhoto(800, 600), { width: 800, height: 600 });
  assert.throws(() => fitPhoto(0, 3));
  assert.throws(() => fitPhoto(Infinity, 4));
});
test("server reads JPEG frame dimensions and rejects oversized, truncated or mislabelled photos", () => {
  assert.deepEqual(jpegDimensions(header(1080, 720)), {
    width: 1080,
    height: 720,
  });
  assert.throws(() => jpegDimensions(header(1081, 720)), /1080/);
  assert.throws(() => jpegDimensions(header(720, 1081)), /1080/);
  assert.throws(() => jpegDimensions(header(0, 720)));
  assert.throws(() => jpegDimensions(header(1080, 720).subarray(0, 18)));
  const broken = header(1080, 720);
  broken[5] = 255;
  assert.throws(() => jpegDimensions(broken));
  assert.throws(() => jpegDimensions(new Uint8Array(1024 * 1024 + 1)));
  assert.throws(() =>
    jpegDimensions(new TextEncoder().encode("<svg onload=alert(1)></svg>")),
  );
});
