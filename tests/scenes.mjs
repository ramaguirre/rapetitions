// Synthetic camera views for Motion mode, rendered straight to the 16 x 12 grid the app uses.
// They imitate the director's real setups: phone under the head for push-ups, phone at the feet
// looking up for deadlifts, plus human timing (pauses, tempo varying from rep to rep).

export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
export function gauss(r) {
  return Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
}

/**
 * Human rep timing. Each rep: `rest` fraction at the start position, then down, a hold at the
 * bottom, up. Tempo varies by +-`jitter` from rep to rep. depth(t) is 0 at the start position, 1 at
 * the far end. Returns {depth, repEnds, end}.
 */
export function humanReps({ start = 3, reps = 10, period = 2, jitter = 0.15, rest = 0.25, hold = 0.1, seed = 1 }) {
  const r = rng(seed);
  const spans = [];
  let t = start;
  for (let k = 0; k < reps; k++) {
    const P = period * (1 + jitter * (2 * r() - 1));
    spans.push([t, t + P]);
    t += P;
  }
  const move = (1 - rest - hold) / 2;
  const depth = (tt) => {
    const sp = spans.find(([a, b]) => tt >= a && tt < b);
    if (!sp) return 0;
    const ph = (tt - sp[0]) / (sp[1] - sp[0]);
    if (ph < rest) return 0;
    if (ph < rest + move) return (1 - Math.cos((Math.PI * (ph - rest)) / move)) / 2;
    if (ph < rest + move + hold) return 1;
    return (1 + Math.cos((Math.PI * (ph - rest - move - hold)) / move)) / 2;
  };
  return { depth, repEnds: spans.map((s) => s[1]), end: t };
}

const COLS = 16, ROWS = 12;

/** Renders one frame: `scene(x, y)` gives a grey level 0..255 for a grid cell centre. */
function render(scene, r, gain = 1, noise = 5) {
  const rgba = new Uint8ClampedArray(COLS * ROWS * 4);
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    const v = gain * scene(x + 0.5, y + 0.5) + noise * gauss(r);
    const i = 4 * (y * COLS + x);
    rgba[i] = rgba[i + 1] = rgba[i + 2] = v;
    rgba[i + 3] = 255;
  }
  return rgba;
}

/**
 * Phone on the floor under the head, push-ups. Up: ceiling, a lamp, the face small and far.
 * Down: the face fills most of the frame. Auto exposure brightens when the darker face is close.
 */
export function pushupFrame(depth, r) {
  const radius = 2 + 6.5 * depth;
  const face = (x, y) => ((x - 8) / 1.0) ** 2 + ((y - 6) / 1.25) ** 2 < radius * radius;
  const scene = (x, y) => {
    if (face(x, y)) return 95 + 20 * Math.cos(x / 1.5) + (Math.abs(x - 8) < 1 && y > 6 ? -30 : 0);
    const lamp = (x - 12) ** 2 + (y - 2) ** 2 < 3 ? 250 : 0;
    return Math.max(lamp, 175 + 8 * Math.sin(y / 2));
  };
  return render(scene, r, 1 + 0.35 * depth);
}

/**
 * Phone at the feet looking up, deadlifts. At the bottom the torso and the bar cover most of the
 * view; at lockout the body is a narrow dark column against the bright ceiling and its lights.
 */
export function deadliftFrame(depth, r) {
  const scene = (x, y) => {
    const lights = ((x - 3) ** 2 + (y - 2) ** 2 < 2 || (x - 13) ** 2 + (y - 3) ** 2 < 2) ? 255 : 190;
    const halfWidth = 2 + 5 * depth;         // body widens in the view as the torso leans over
    const top = 1 + 6 * (1 - depth);           // and the head comes into view
    const bodyRow = y > 12 - (12 - top);
    const body = Math.abs(x - 8) < halfWidth && y >= top && bodyRow;
    const barY = 11 - 5 * depth;               // the bar travels up the frame
    if (Math.abs(y - barY) < 0.7) return 30;
    return body ? 70 + 10 * Math.sin(y) : lights;
  };
  return render(scene, r, 1 - 0.2 * depth);
}

/** Someone walking into place before the set: a big dark shape crossing the view. */
export function walkInFrame(t, walk, r, base) {
  const cx = -4 + 14 * (t / walk);
  const frame = base(0, r);
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    if (Math.abs(x + 0.5 - cx) < 3) {
      const i = 4 * (y * COLS + x);
      frame[i] = frame[i + 1] = frame[i + 2] = 50 + 5 * gauss(r);
    }
  }
  return frame;
}
