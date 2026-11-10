import { test } from "node:test";
import assert from "node:assert/strict";
import { RestTimer, clock } from "../src/rest.js";
import { RepCounter } from "../src/counter.js";

test("announces each whole minute once", () => {
  const r = new RestTimer();
  r.start(10);
  const said = [];
  for (let t = 10; t < 10 + 190; t += 0.7) { const m = r.tick(t); if (m) said.push([m, Math.round(t - 10)]); }
  assert.deepEqual(said.map((x) => x[0]), [1, 2, 3]);
  for (const [m, at] of said) assert.ok(at >= 60 * m && at <= 60 * m + 1, `minute ${m} said at ${at} s`);
});

test("starts from the last rep, ends where the next set began", () => {
  const r = new RestTimer();
  r.start(100);                   // last rep at 100 s; the set is closed a few seconds later
  assert.equal(r.elapsed(105), 5);
  const length = r.stop(200, 3, 2); // locked at 200 s with 3 reps of 2 s: set began at 194 s
  assert.equal(length, 94);
  assert.equal(r.resting, false);
  assert.equal(r.tick(300), 0);
  assert.deepEqual(r.rests, [94]);
});

test("a new rest starts its minutes again", () => {
  const r = new RestTimer();
  r.start(0); r.tick(61); r.stop(70);
  r.start(100);
  assert.equal(r.tick(159), 0);
  assert.equal(r.tick(160), 1);
});

test("clock format", () => {
  assert.equal(clock(0), "0:00");
  assert.equal(clock(83.9), "1:23");
  assert.equal(clock(600), "10:00");
});

test("the counter reports the last rep's time when a set ends", () => {
  const c = new RepCounter({ minSwing: 0.5 });
  let end = null, lastRep = null;
  for (let t = 0; t < 40; t += 1 / 20) {
    const x = t > 2 && t < 22 ? Math.sin((2 * Math.PI * (t - 2)) / 2) : 0;
    for (const e of c.push(t, [x, 0.5 * x])) {
      if (e.type === "rep" || e.type === "lock") lastRep = e.t;
      if (e.type === "setEnd") end = e;
    }
  }
  assert.ok(end, "set never ended");
  assert.ok(Math.abs(end.lastRepT - lastRep) < 1e-9 || end.lastRepT >= lastRep - 2.1, "lastRepT missing");
  assert.ok(end.lastRepT < 22.5 && end.lastRepT > 19, `lastRepT ${end.lastRepT}`);
});
