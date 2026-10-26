import { test } from "node:test";
import assert from "node:assert/strict";
import { captureHaptic, TONES } from "../src/gameFeedback.js";
test("capture haptics are brief, optional, visible-only and safe on unsupported devices", () => {
  const calls: number[][] = [],
    device = {
      vibrate: (pattern: number[]) => {
        calls.push(pattern);
        return true;
      },
      userActivation: { hasBeenActive: true },
    };
  assert(captureHaptic(true, true, device));
  assert.equal(calls.length, 1);
  assert(calls[0].reduce((a, b) => a + b, 0) < 120);
  assert(!captureHaptic(false, true, device));
  assert(!captureHaptic(true, false, device));
  assert(!captureHaptic(true, true, {}));
  assert(
    !captureHaptic(true, true, {
      ...device,
      userActivation: { hasBeenActive: false },
    }),
  );
  assert(
    !captureHaptic(true, true, {
      vibrate: () => {
        throw new Error("Denied");
      },
    }),
  );
  assert.equal(calls.length, 1);
});
test("dice and token sounds differ, with short quiet envelopes", () => {
  assert.notDeepEqual(TONES.roll, TONES.move);
  for (const tones of Object.values(TONES))
    for (const tone of tones) {
      assert(tone.gain <= 0.02);
      assert(tone.at + tone.duration <= 0.25);
      assert(tone.from > 0 && tone.to > 0);
    }
});
