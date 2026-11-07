// Turning a camera frame into the feature vector the counter works on.
// No browser APIs here either (the motion grid takes raw RGBA bytes), so it is tested in Node.

// MediaPipe pose landmarks used: nose and the body (11-32). The other face points only add jitter.
export const BODY_POINTS = [0, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32];

export const SKELETON = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28], [27, 31], [28, 32], [27, 29], [28, 30],
];

/**
 * Pose features: landmark positions in "torso lengths", so the numbers do not depend on how far the
 * person stands from the phone. Positions are not centred on the body: the camera stands still, and
 * moving the whole body (a squat, a jump) is exactly the signal. Each point is weighted by how
 * visible it has been lately, so legs out of the picture do not add noise.
 */
export class PoseFeatures {
  constructor() {
    this.scale = null;
    this.weights = new Float64Array(BODY_POINTS.length).fill(1);
  }

  reset() {
    this.scale = null;
    this.weights.fill(1);
  }

  /** `lm`: array of {x, y, visibility} in 0..1 image units; `aspect` = width / height. */
  compute(lm, aspect) {
    if (!lm || lm.length < 33) return null;
    const P = (i) => ({ x: lm[i].x * aspect, y: lm[i].y });
    const sh = mid(P(11), P(12)), hip = mid(P(23), P(24));
    const torso = Math.hypot(sh.x - hip.x, sh.y - hip.y);
    if (!(torso > 0.02)) return null;
    // Slow follow: the scale must not swing with every rep.
    this.scale = this.scale === null ? torso : 0.98 * this.scale + 0.02 * torso;
    const f = new Array(BODY_POINTS.length * 2);
    BODY_POINTS.forEach((idx, k) => {
      const vis = lm[idx].visibility ?? 1;
      this.weights[k] = 0.95 * this.weights[k] + 0.05 * clamp01((vis - 0.3) / 0.5);
      const w = this.weights[k];
      const p = P(idx);
      f[2 * k] = (w * p.x) / this.scale;
      f[2 * k + 1] = (w * p.y) / this.scale;
    });
    return f;
  }
}

/**
 * Motion features: the frame shrunk to a coarse grey grid (default 16 x 12). Works for any repeated
 * movement, even when no full body is in view (an arm, a rowing machine, a skipping rope).
 * `rgba` are the bytes of a `cols x rows` image (canvas getImageData).
 *
 * Each grid is normalised by its own mean and spread. The camera's automatic exposure and white
 * balance brighten or darken the whole picture at once (a gain and an offset on every cell); after
 * normalising, those shifts cancel and only things that moved remain.
 */
export function motionFeatures(rgba, cols = 16, rows = 12) {
  const n = cols * rows;
  const f = new Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const r = rgba[4 * i], g = rgba[4 * i + 1], b = rgba[4 * i + 2];
    f[i] = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    sum += f[i];
  }
  const mean = sum / n;
  let ss = 0;
  for (let i = 0; i < n; i++) ss += (f[i] - mean) ** 2;
  const sd = Math.sqrt(ss / n);
  // A flat picture (lens covered, dark room) has no structure to normalise: keep it flat.
  const k = sd > 0.01 ? 1 / sd : 0;
  for (let i = 0; i < n; i++) f[i] = (f[i] - mean) * k;
  return f;
}

function mid(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
