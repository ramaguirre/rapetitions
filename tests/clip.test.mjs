// Node tests for the rep clips: which rep is kept, which frames, and the GIF file itself.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { RepPicker, clipFrames, clipSize, CLIP } from "../src/clip.js";
import { encodeGif, buildPalette } from "../src/gif.js";
import { RepCounter } from "../src/counter.js";
import { MOTION_OPTIONS } from "../src/modes.js";
import { motionFeatures } from "../src/features.js";

test("keeps the most typical rep, never the first", () => {
  const p = new RepPicker();
  const ends = [10, 12, 14.6, 16.6, 19.6, 21.6]; // lengths 2, 2.6, 2, 3 (a pause), 2
  const kept = ends.map((t) => p.rep(t));
  assert.equal(kept[0], null, "the first rep has no start");
  assert.deepEqual(kept[1], { start: 10, end: 12 });
  assert.equal(kept[2], null, "a slow rep does not replace a typical one");
  assert.equal(kept[4], null, "nor does a paused one");
  assert.ok(Math.abs(p.kept.end - p.kept.start - 2) < 1e-9, `kept a ${p.kept.end - p.kept.start} s rep`);
});

test("a rep whose frames are gone is not kept; a new set starts afresh", () => {
  const p = new RepPicker();
  p.rep(1); p.rep(3, 5);
  assert.equal(p.kept, null);
  assert.deepEqual(p.rep(5, 2), { start: 3, end: 5 });
  p.reset();
  assert.equal(p.rep(40), null);
  assert.deepEqual(p.rep(42), { start: 40, end: 42 });
});

test("clip frames: one rep, capped rate and count, delays add up to the rep", () => {
  const frames = Array.from({ length: 400 }, (_, i) => ({ t: i / 15 }));
  const quick = clipFrames(frames, 2, 4);
  assert.equal(quick.length, 2 * CLIP.fps);
  assert.ok(quick.every((f) => f.t >= 2 && f.t < 4));
  const sum = (c) => c.reduce((s, f) => s + f.delay, 0);
  assert.ok(Math.abs(sum(quick) - (4 - quick[0].t)) < 1e-9);
  const slow = clipFrames(frames, 5, 15);
  assert.equal(slow.length, CLIP.maxFrames);
  assert.ok(Math.abs(sum(slow) - (15 - slow[0].t)) < 1e-9);
  assert.deepEqual(clipFrames(frames, 30, 32), []);
  assert.deepEqual(clipSize(640, 480), { w: 240, h: 180 });
  assert.deepEqual(clipSize(480, 640), { w: 180, h: 240 });
});

test("the counter reports when each rep counted at lock ended", () => {
  const c = new RepCounter(MOTION_OPTIONS);
  const period = 2, start = 2;
  let lock = null, last = null;
  for (let t = 0; t < start + 8 * period; t += 1 / 15) {
    const ph = t >= start ? ((t - start) / period) % 1 : 0;
    const cy = 3 + 5 * (1 - Math.cos(2 * Math.PI * ph)) / 2;
    const rgba = new Uint8ClampedArray(16 * 12 * 4);
    for (let y = 0; y < 12; y++) for (let x = 0; x < 16; x++) {
      const i = 4 * (y * 16 + x), v = Math.abs(y - cy) < 2 && x > 4 && x < 11 ? 210 : 50 + 3 * ((x * 7 + y * 13 + Math.round(t * 15)) % 5);
      rgba[i] = rgba[i + 1] = rgba[i + 2] = v; rgba[i + 3] = 255;
    }
    for (const e of c.push(t, motionFeatures(rgba, 16, 12))) { if (e.type === "lock") lock = e; if (e.type === "rep") last = e; }
  }
  assert.ok(lock, "never locked");
  assert.equal(lock.repTimes.length, lock.reps);
  for (let k = 1; k < lock.repTimes.length; k++) {
    const gap = lock.repTimes[k] - lock.repTimes[k - 1];
    assert.ok(Math.abs(gap - period) < 0.3, `gap ${gap.toFixed(2)} s`);
  }
  assert.ok(lock.repTimes.at(-1) <= lock.t && last.t > lock.t);
});

/** A small moving picture: a coloured block bouncing over a gradient. */
function scene(w, h, n) {
  return Array.from({ length: n }, (_, f) => {
    const data = new Uint8ClampedArray(w * h * 4);
    const by = Math.round((h - 12) * (1 - Math.cos((2 * Math.PI * f) / n)) / 2);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = 4 * (y * w + x), box = y >= by && y < by + 12 && x > 10 && x < 30;
      data[i] = box ? 230 : 4 * x; data[i + 1] = box ? 60 : 3 * y; data[i + 2] = box ? 40 : 120; data[i + 3] = 255;
    }
    return { data, delay: 0.125 };
  });
}

test("palette: at most 255 colours, close to the picture", () => {
  const frames = scene(48, 36, 6);
  const { palette, lookup } = buildPalette(frames, 255);
  assert.ok(palette.length <= 255 && palette.length > 50);
  const d = frames[2].data;
  let worst = 0;
  for (let k = 0; k < d.length; k += 4) {
    const c = palette[lookup[((d[k] >> 3) << 10) | ((d[k + 1] >> 3) << 5) | (d[k + 2] >> 3)]];
    worst = Math.max(worst, Math.abs(c[0] - d[k]), Math.abs(c[1] - d[k + 1]), Math.abs(c[2] - d[k + 2]));
  }
  assert.ok(worst <= 12, `worst channel error ${worst}`);
});

test("GIF: loops, right size and timing, and decodes to the frames (Pillow)", (t) => {
  const w = 48, h = 36, frames = scene(w, h, 8);
  const gif = encodeGif(frames, w, h);
  assert.equal(String.fromCharCode(...gif.slice(0, 6)), "GIF89a");
  assert.equal(gif[6] | (gif[7] << 8), w);
  assert.equal(gif[8] | (gif[9] << 8), h);
  assert.equal(gif.at(-1), 0x3b);
  const file = path.join(mkdtempSync(path.join(tmpdir(), "rap-gif-")), "clip.gif");
  writeFileSync(file, gif);
  let out;
  try {
    out = execFileSync("python3", ["-c", `
import sys, json
from PIL import Image
im = Image.open(sys.argv[1]); res = {"n": im.n_frames, "loop": im.info.get("loop"), "delays": [], "err": 0}
for f in range(im.n_frames):
    im.seek(f); res["delays"].append(im.info.get("duration")); rgb = im.convert("RGB")
    res.setdefault("px", []).append(list(rgb.getdata()))
print(json.dumps(res))`, file], { encoding: "utf8", maxBuffer: 1 << 26 });
  } catch (err) {
    t.skip(`Pillow not available (${String(err).slice(0, 60)})`);
    return;
  }
  const res = JSON.parse(out);
  assert.equal(res.n, frames.length);
  assert.equal(res.loop, 0);
  assert.deepEqual(res.delays, frames.map(() => 130).map((_, i) => (i % 2 ? 120 : 130)));
  let worst = 0;
  res.px.forEach((px, f) => px.forEach((c, i) => {
    for (let ch = 0; ch < 3; ch++) worst = Math.max(worst, Math.abs(c[ch] - frames[f].data[4 * i + ch]));
  }));
  assert.ok(worst <= 12, `worst channel error after decoding ${worst}`);
});

test("GIF: a 240 x 180 clip of 60 noisy frames stays small enough to keep many", () => {
  const w = 240, h = 180;
  let s = 7;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const frames = scene(w, h, 60).map((fr) => {
    for (let k = 0; k < fr.data.length; k += 4) for (let c = 0; c < 3; c++) fr.data[k + c] += Math.round(6 * (rnd() - 0.5));
    return fr;
  });
  const t0 = Date.now();
  const gif = encodeGif(frames, w, h);
  const ms = Date.now() - t0;
  assert.ok(gif.length < 1.5e6, `${(gif.length / 1e6).toFixed(2)} MB`);
  console.log(`     240x180, 60 noisy frames: ${(gif.length / 1e3).toFixed(0)} kB in ${ms} ms`);
});
