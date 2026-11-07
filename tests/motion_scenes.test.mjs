// Motion mode on synthetic camera views of real setups. Run: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { RepCounter } from "../src/counter.js";
import { motionFeatures } from "../src/features.js";
import { MOTION_OPTIONS } from "../src/modes.js";
import { rng, humanReps, pushupFrame, deadliftFrame, walkInFrame } from "./scenes.mjs";

function run(frameFn, timing, { fps = 15, walk = 0, seed = 3 } = {}) {
  const r = rng(seed);
  const tm = humanReps({ ...timing, start: walk + 2, seed });
  const counter = new RepCounter(MOTION_OPTIONS);
  let lock = null;
  for (let t = 0; t < tm.end + 3 * timing.period + 5; t += 1 / fps) { // long enough for the set to close
    const rgba = t < walk ? walkInFrame(t, walk, r, frameFn) : frameFn(tm.depth(t), r);
    for (const e of counter.push(t, motionFeatures(rgba))) if (e.type === "lock" && !lock) lock = e;
  }
  const lockedAfter = lock ? tm.repEnds.filter((te) => te <= lock.t).length : null;
  return { counter, lock, lockedAfter, reps: tm.repEnds.length };
}

const SETUPS = [
  ["push-ups, phone under the head", pushupFrame, [1.2, 2, 3]],
  ["deadlifts, phone at the feet", deadliftFrame, [2.5, 4, 6, 7.5]],
];

for (const [name, frameFn, periods] of SETUPS) {
  for (const period of periods) {
    for (const walk of [0, 5]) {
      test(`${name}: ${period} s reps${walk ? ", after walking into place" : ""}`, () => {
        const reps = 8;
        const { counter, lockedAfter } = run(frameFn, { reps, period }, { walk });
        assert.ok(lockedAfter !== null, "never started counting");
        assert.ok(lockedAfter <= 3, `started counting only after ${lockedAfter} reps`);
        assert.deepEqual(counter.sets, [reps]);
      });
    }
  }
}

test("phone under the head, nobody there: nothing counted", () => {
  const r = rng(4);
  const counter = new RepCounter(MOTION_OPTIONS);
  for (let t = 0; t < 60; t += 1 / 15) counter.push(t, motionFeatures(pushupFrame(0, r)));
  assert.equal(counter.total, 0);
});
