// Which rep of a set to keep as a looping clip, and which frames make it. No browser APIs, so it is
// tested in Node (tests/clip.test.mjs).
//
// A rep is counted as the body comes back to rest, so one rep runs from one count to the next:
// rest, bottom, rest. Played on a loop it joins up with itself. The first rep of a set has no
// start (no count before it), so it is never kept. Of the others, the one whose length is closest
// to the set's typical length is kept: not a rushed rep, not one with a pause.

export const CLIP = {
  fps: 8,          // frames kept per second (the counter runs at up to 15)
  maxFrames: 60,   // longest clip; slow reps get fewer frames per second
  keepSec: 12,     // seconds of frames kept in memory (longest rep is 10 s)
  width: 240,      // longest side of the clip, pixels
};

export class RepPicker {
  constructor() {
    this.reset();
  }

  reset() {
    this.lastT = null;   // end of the previous rep in this set
    this.lengths = [];   // lengths of this set's reps, seconds
    this.kept = null;    // {start, end}
  }

  /**
   * A rep ended at `t`. `firstAvailable` is the time of the oldest frame still in memory.
   * Returns {start, end} when this rep should replace the one kept, otherwise null.
   */
  rep(t, firstAvailable = -Infinity) {
    const start = this.lastT;
    this.lastT = t;
    if (start === null) return null;
    this.lengths.push(t - start);
    if (start < firstAvailable) return null;
    const typical = median(this.lengths);
    const off = (r) => Math.abs(r.end - r.start - typical);
    const cand = { start, end: t };
    if (this.kept && off(this.kept) <= off(cand)) return null;
    this.kept = cand;
    return cand;
  }
}

/**
 * Frames of one rep, from `start` up to (not including) `end`, at most CLIP.fps per second and
 * CLIP.maxFrames in all, each with how long it shows. `frames` = [{t, ...}] in time order.
 */
export function clipFrames(frames, start, end, opts = CLIP) {
  const inside = frames.filter((f) => f.t >= start && f.t < end);
  if (!inside.length) return [];
  const n = Math.max(1, Math.min(inside.length, opts.maxFrames, Math.round((end - start) * opts.fps)));
  const picked = [];
  for (let i = 0; i < n; i++) picked.push(inside[Math.floor((i * inside.length) / n)]);
  return picked.map((f, i) => ({ ...f, delay: (i + 1 < n ? picked[i + 1].t : end) - f.t }));
}

/** Size of the clip for a video of vw x vh: longest side CLIP.width, even numbers. */
export function clipSize(vw, vh, longest = CLIP.width) {
  const s = longest / Math.max(vw, vh);
  return { w: 2 * Math.round((vw * s) / 2), h: 2 * Math.round((vh * s) / 2) };
}

function median(a) {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
