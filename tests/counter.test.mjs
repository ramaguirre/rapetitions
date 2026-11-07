// Node tests for the counting method, on synthetic people. Run: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { RepCounter, findPeriod } from "../src/counter.js";
import { PoseFeatures, motionFeatures } from "../src/features.js";
import { POSE_OPTIONS, MOTION_OPTIONS } from "../src/modes.js";

// Deterministic random numbers, so a failure can be replayed.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
function gauss(r) {
  return Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
}

/**
 * A timeline of reps. `plan` = list of segments: {rest: seconds} or {reps, period, endPeriod?}.
 * Returns depth(t) in 0..1 (0 = rest position) and the times each rep ends.
 */
function timeline(plan) {
  const segs = [];
  let t = 0;
  const repEnds = [];
  for (const s of plan) {
    if (s.rest) { segs.push({ t0: t, t1: t + s.rest, kind: "rest" }); t += s.rest; continue; }
    for (let k = 0; k < s.reps; k++) {
      const P = s.endPeriod ? s.period + (s.endPeriod - s.period) * (k / Math.max(1, s.reps - 1)) : s.period;
      segs.push({ t0: t, t1: t + P, kind: "rep", shape: s.shape ?? "smooth" });
      t += P;
      repEnds.push(t);
    }
  }
  const depth = (tt) => {
    const sg = segs.find((g) => tt >= g.t0 && tt < g.t1);
    if (!sg || sg.kind === "rest") return 0;
    const ph = (tt - sg.t0) / (sg.t1 - sg.t0);
    if (sg.shape === "pause") {
      // Down 35%, hold at the bottom 30%, up 35%: a squat with a pause.
      if (ph < 0.35) return (1 - Math.cos(Math.PI * ph / 0.35)) / 2;
      if (ph < 0.65) return 1;
      return (1 + Math.cos(Math.PI * (ph - 0.65) / 0.35)) / 2;
    }
    return (1 - Math.cos(2 * Math.PI * ph)) / 2;
  };
  return { depth, duration: t, repEnds };
}

// A standing figure (MediaPipe indices, image units) and how each point moves in a squat.
function squatLandmarks(depth, r, noise = 0.004) {
  const base = {};
  const set = (i, x, y) => { base[i] = { x, y }; };
  set(0, 0.5, 0.15);
  for (let i = 1; i <= 10; i++) set(i, 0.5 + 0.01 * (i % 3), 0.14);
  set(11, 0.44, 0.27); set(12, 0.56, 0.27);
  set(13, 0.40, 0.40); set(14, 0.60, 0.40);
  set(15, 0.39, 0.52); set(16, 0.61, 0.52);
  for (const i of [17, 19, 21]) set(i, 0.39, 0.55);
  for (const i of [18, 20, 22]) set(i, 0.61, 0.55);
  set(23, 0.46, 0.55); set(24, 0.54, 0.55);
  set(25, 0.46, 0.72); set(26, 0.54, 0.72);
  set(27, 0.46, 0.90); set(28, 0.54, 0.90);
  set(29, 0.45, 0.92); set(30, 0.55, 0.92);
  set(31, 0.47, 0.93); set(32, 0.53, 0.93);
  const out = [];
  for (let i = 0; i < 33; i++) {
    let { x, y } = base[i];
    if (i <= 24) y += 0.2 * depth;                 // upper body and hips go down
    if (i >= 13 && i <= 22) x += (i % 2 ? -1 : 1) * -0.05 * depth; // arms come forward/in
    if (i === 25 || i === 26) { y += 0.08 * depth; x += (i === 25 ? -0.06 : 0.06) * depth; }
    out.push({ x: x + noise * gauss(r), y: y + noise * gauss(r), visibility: i >= 25 ? 0.6 + 0.3 * r() : 0.95 });
  }
  return out;
}

function runPose(plan, { seed = 1, fps = 30, jitter = 0, drop = 0, noise = 0.004, tail = 6 } = {}) {
  const r = rng(seed);
  const tl = timeline(plan);
  const counter = new RepCounter(POSE_OPTIONS);
  const pf = new PoseFeatures();
  const events = [];
  for (let t = 0; t < tl.duration + tail; t += (1 / fps) * (1 + jitter * (r() - 0.5))) {
    const lm = r() < drop ? null : squatLandmarks(tl.depth(t), r, noise);
    const f = lm ? pf.compute(lm, 9 / 16) : null;
    for (const e of counter.push(t, f)) events.push(e);
  }
  return { counter, events, tl };
}

test("finds the period of a clean sine", () => {
  const hz = 20, p = [];
  for (let i = 0; i < 200; i++) p.push(Math.sin((2 * Math.PI * i) / (2.3 * hz)));
  const f = findPeriod(p, hz, 0.5, 5, 3, 0.5);
  assert.ok(Math.abs(f.period - 2.3) < 0.05, `period ${f.period}`);
});

test("ten squats are counted, including the first ones", () => {
  const { counter, events } = runPose([{ rest: 3 }, { reps: 10, period: 2.2 }, { rest: 2 }]);
  assert.equal(counter.total, 10);
  assert.deepEqual(counter.sets, [10]);
  assert.equal(events.filter((e) => e.type === "lock").length, 1);
});

test("counting starts after about three reps", () => {
  const { events, tl } = runPose([{ rest: 2 }, { reps: 8, period: 2 }]);
  const lock = events.find((e) => e.type === "lock");
  assert.ok(lock, "never locked");
  assert.ok(lock.t < tl.repEnds[3], `locked late, at ${lock.t.toFixed(1)} s (4th rep ends ${tl.repEnds[3].toFixed(1)} s)`);
  assert.ok(lock.reps >= 2 && lock.reps <= 5, `reps at lock ${lock.reps}`);
});

test("squats with a pause at the bottom", () => {
  const { counter } = runPose([{ rest: 2 }, { reps: 9, period: 3, shape: "pause" }]);
  assert.equal(counter.total, 9);
});

test("tempo that slows down through the set", () => {
  const { counter } = runPose([{ rest: 2 }, { reps: 12, period: 1.6, endPeriod: 2.8 }]);
  assert.equal(counter.total, 12);
});

test("fast reps (jumping-jack speed)", () => {
  const { counter } = runPose([{ rest: 2 }, { reps: 20, period: 0.8 }]);
  assert.equal(counter.total, 20);
});

test("slow reps", () => {
  const { counter } = runPose([{ rest: 2 }, { reps: 6, period: 4.2 }]);
  assert.equal(counter.total, 6);
});

test("two sets with a rest in between", () => {
  const { counter } = runPose([{ rest: 2 }, { reps: 8, period: 2 }, { rest: 12 }, { reps: 6, period: 2.5 }]);
  assert.deepEqual(counter.sets, [8, 6]);
  assert.equal(counter.total, 14);
});

test("uneven frame rate, dropped frames and more noise", () => {
  for (const seed of [2, 3, 4]) {
    const { counter } = runPose([{ rest: 2 }, { reps: 10, period: 2 }], { seed, fps: 15, jitter: 0.6, drop: 0.15, noise: 0.008 });
    assert.equal(counter.total, 10, `seed ${seed}`);
  }
});

test("standing still counts nothing", () => {
  const { counter } = runPose([{ rest: 40 }], { noise: 0.006 });
  assert.equal(counter.total, 0);
});

test("random fidgeting counts nothing", () => {
  for (let seed = 9; seed < 21; seed++) {
    const r = rng(seed);
    const counter = new RepCounter(POSE_OPTIONS);
    const pf = new PoseFeatures();
    let depth = 0, vel = 0;
    for (let t = 0; t < 60; t += 1 / 30) {
      vel = 0.97 * vel + 0.02 * gauss(r);
      depth = Math.max(-0.3, Math.min(0.5, depth + vel / 30 * 4));
      counter.push(t, pf.compute(squatLandmarks(depth, r), 9 / 16));
    }
    assert.equal(counter.total, 0, `seed ${seed}`);
  }
});

/**
 * Motion-mode clip on the 16 x 12 grid. `move` says whether the bright patch does its reps;
 * `awb(t)` returns {gain, offset} applied to the whole picture, like auto exposure / white balance.
 */
function runMotion({ reps = 12, period = 1.8, move = true, awb = () => ({ gain: 1, offset: 0 }), seed = 5 } = {}) {
  const cols = 16, rows = 12;
  const r = rng(seed);
  const counter = new RepCounter(MOTION_OPTIONS);
  const end = 2 + reps * period;
  for (let t = 0; t < end + 5; t += 1 / 24) {
    const ph = move && t > 2 && t < end ? ((t - 2) / period) % 1 : 0;
    const cy = 2 + 7 * (1 - Math.cos(2 * Math.PI * ph)) / 2;
    const { gain, offset } = awb(t);
    const rgba = new Uint8ClampedArray(cols * rows * 4);
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const inside = Math.abs(y - cy) < 1.5 && x > 5 && x < 11;
      // Background texture; levels stay below white even at +30 % gain. Clipped pixels do not
      // follow a brightness change, so a picture that saturates at the pace of the reps could still fool it.
      const scene = (inside ? 140 : 60) + 25 * Math.sin(x / 3) + 15 * Math.cos(y / 2);
      const v = gain * scene + offset + 6 * gauss(r);
      const i = 4 * (y * cols + x);
      rgba[i] = rgba[i + 1] = rgba[i + 2] = v; rgba[i + 3] = 255;
    }
    counter.push(t, motionFeatures(rgba, cols, rows));
  }
  return counter;
}

test("motion grid: a bright patch moving up and down", () => {
  assert.equal(runMotion().total, 12);
});

test("motion grid: auto white balance drifting and jumping while moving", () => {
  const awb = (t) => ({ gain: 1 + 0.25 * Math.sin(t / 1.1), offset: t % 9 < 4.5 ? 0 : -20 });
  assert.equal(runMotion({ awb }).total, 12);
});

test("motion grid: auto white balance pulsing at a rep-like pace, nobody moving", () => {
  for (const period of [1.2, 2, 3]) {
    const awb = (t) => ({ gain: 1 + 0.3 * Math.sin((2 * Math.PI * t) / period), offset: 10 * Math.cos((2 * Math.PI * t) / period) });
    assert.equal(runMotion({ move: false, awb, reps: 15 }).total, 0, `period ${period}`);
  }
});

test("motion grid: a still scene counts nothing", () => {
  assert.equal(runMotion({ move: false, reps: 20 }).total, 0);
});

test("arm curls: only the forearms move", () => {
  const r = rng(21);
  const tl = timeline([{ rest: 2 }, { reps: 10, period: 2.4 }]);
  const counter = new RepCounter(POSE_OPTIONS);
  const pf = new PoseFeatures();
  for (let t = 0; t < tl.duration + 5; t += 1 / 30) {
    const lm = squatLandmarks(0, r);
    const a = tl.depth(t) * 2.4; // elbow angle change, radians
    for (const [elbow, ids] of [[13, [15, 17, 19, 21]], [14, [16, 18, 20, 22]]]) {
      for (const i of ids) {
        const dx = lm[i].x - lm[elbow].x, dy = lm[i].y - lm[elbow].y;
        lm[i].x = lm[elbow].x + dx * Math.cos(a) - dy * Math.sin(a) * (elbow === 13 ? 1 : -1) * 0.3;
        lm[i].y = lm[elbow].y + dx * Math.sin(a) * 0.3 + dy * Math.cos(a);
      }
    }
    counter.push(t, pf.compute(lm, 9 / 16));
  }
  assert.equal(counter.total, 10);
});

/** Locks within `maxRep` reps even after a big non-repeating movement (walking back from the phone). */
function lockAfterWalkIn({ period, mode }) {
  const r = rng(31);
  const reps = 8, walk = 6;
  const repEnds = Array.from({ length: reps }, (_, k) => walk + (k + 1) * period);
  const end = walk + reps * period;
  const counter = new RepCounter(mode === "pose" ? POSE_OPTIONS : MOTION_OPTIONS);
  const pf = new PoseFeatures();
  let lock = null;
  for (let t = 0; t < end + 4; t += 1 / 15) {
    let f;
    if (mode === "pose") {
      const lm = squatLandmarks(t >= walk && t < end ? (1 - Math.cos((2 * Math.PI * (t - walk)) / period)) / 2 * 0.6 : 0, r);
      if (t < walk) for (const p of lm) { p.x += 0.4 * (1 - t / walk); p.y -= 0.1 * Math.sin(t * 3); } // walking in from the side
      f = pf.compute(lm, 9 / 16);
    } else {
      const cols = 16, rows = 12, rgba = new Uint8ClampedArray(cols * rows * 4);
      const cx = t < walk ? 1 + 7 * (t / walk) : 8; // a big dark shape walks in...
      const ph = t >= walk && t < end ? ((t - walk) / period) % 1 : 0;
      const cy = 4 + 2.5 * (1 - Math.cos(2 * Math.PI * ph)) / 2; // ...then bobs a little
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        const body = Math.abs(x - cx) < 2.5 && y > cy;
        const v = (body ? 40 : 150) + 20 * Math.sin(x / 2.5) + 6 * gauss(r);
        const i = 4 * (y * cols + x);
        rgba[i] = rgba[i + 1] = rgba[i + 2] = v; rgba[i + 3] = 255;
      }
      f = motionFeatures(rgba, cols, rows);
    }
    for (const e of counter.push(t, f)) if (e.type === "lock" && !lock) lock = e;
  }
  return { lock, repEnds, counter, reps };
}

for (const mode of ["motion", "pose"]) {
  for (const period of [0.8, 1.2, 2]) {
    test(`${mode}: short loops (${period} s) lock by the 4th rep after walking in`, () => {
      const { lock, repEnds, counter, reps } = lockAfterWalkIn({ period, mode });
      assert.ok(lock, "never locked");
      const n = repEnds.filter((te) => te <= lock.t).length;
      assert.ok(n <= 4, `locked after ${n} reps`);
      assert.equal(counter.total, reps);
    });
  }
}
