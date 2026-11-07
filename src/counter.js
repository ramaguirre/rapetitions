// RApetitions rep counter: finds the repeating loop in a stream of feature vectors and counts it.
//
// No browser APIs here, so the whole method is tested in Node (tests/counter.test.mjs).
//
// Method, in short:
//  1. Keep the last `windowSec` seconds of feature vectors (pose landmarks or a coarse motion grid).
//  2. Every `analyseEverySec`, resample them to a uniform grid and find the main direction of motion
//     (first principal component, by power iteration). Projecting onto it gives one number per frame.
//  3. Autocorrelate that signal. A strong peak at lag P means "the motion repeats every P seconds".
//  4. When the same P is found on several analyses in a row and the window already holds
//     `lockReps` cycles, lock: freeze the direction, count the cycles already done (they are
//     included in the count) and keep counting each new cycle live.
//  5. Counting = hysteresis on the projected signal: a rep is a swing from below
//     `mid - h` to above `mid + h`. `mid` and the swing size follow the person slowly.
//  6. No rep for `endAfterPeriods` periods (or the person leaves the view) ends the set.

export const DEFAULTS = {
  analysisHz: 20,        // resampling rate for the analysis
  windowSec: 20,         // history kept for the analysis (>= lockReps * maxPeriod)
  minPeriod: 0.5,        // fastest rep, seconds
  maxPeriod: 5,          // slowest rep, seconds
  lockCorr: 0.5,         // minimum autocorrelation to accept a rhythm
  lockReps: 3,           // cycles that must be seen before counting starts
  stableChecks: 3,       // consecutive analyses that must agree on the period
  periodTolerance: 0.18, // relative spread allowed between those analyses
  minMotion: 0.02,       // minimum spread of the projected signal (feature units)
  minSwing: 0.1,         // minimum rep size (5-95 % range of the projection) to start counting
  hysteresis: 0.2,       // threshold half-width, as a fraction of the swing
  endAfterPeriods: 2.5,  // a set ends after this many periods without a rep...
  endMinSec: 3,          // ...and never sooner than this
  analyseEverySec: 0.25,
  windows: [3, 4.5, 6.5, 9, 13, 20], // look-back windows tried, shortest first (seconds)
};

export class RepCounter {
  constructor(options = {}) {
    this.o = { ...DEFAULTS, ...options };
    this.resetAll();
  }

  resetAll() {
    this.total = 0;
    this.sets = [];          // reps per finished set
    this.ignoreBefore = -Infinity; // frames up to the last rep of the previous set are not reused
    this.resetSet();
  }

  resetSet() {
    this.frames = [];        // {t, f}
    this.state = "searching";
    this.current = 0;        // reps in the current set
    this.candidates = [];
    this.lastAnalysis = -Infinity;
    this.lock = null;
    this.lastSeen = -Infinity;
    this.search = null;      // last analysis, for display
  }

  /** Ends the current set now (for example when the user presses a button). */
  endSet() {
    const events = [];
    if (this.state === "counting") {
      if (this.current > 0) this.sets.push(this.current);
      events.push({ type: "setEnd", reps: this.current, total: this.total });
      this.ignoreBefore = this.lock.lastRepT;
    }
    this.resetSet();
    return events;
  }

  /**
   * Adds one frame. `t` in seconds (increasing); `features` an array of numbers, or null when
   * nothing was seen in this frame (no person). Returns the events it caused:
   * {type: "lock", period, reps}, {type: "rep", reps, total}, {type: "setEnd", reps, total}.
   */
  push(t, features) {
    const o = this.o;
    const events = [];
    if (features) {
      if (this.frames.length && this.frames[0].f.length !== features.length) this.frames = [];
      this.frames.push({ t, f: Float64Array.from(features) });
      this.lastSeen = t;
    }
    while (this.frames.length && this.frames[0].t < t - o.windowSec) this.frames.shift();

    if (this.state === "counting") {
      const L = this.lock;
      if (features) {
        const p = this._project(features, L);
        L.trace.push({ t, p });
        while (L.trace.length && L.trace[0].t < t - Math.max(3 * L.period, 4)) L.trace.shift();
        const rep = this._step(L, t, p);
        if (rep) {
          this.current += 1;
          this.total += 1;
          events.push({ type: "rep", reps: this.current, total: this.total, t });
        }
      }
      if (t - this.lastAnalysis >= o.analyseEverySec) {
        this.lastAnalysis = t;
        this._adapt(L, t);
      }
      const quiet = Math.max(o.endAfterPeriods * L.period, o.endMinSec);
      if (t - L.lastRepT > quiet || t - this.lastSeen > o.endMinSec) {
        events.push(...this.endSet());
      }
      return events;
    }

    if (t - this.lastAnalysis >= o.analyseEverySec) {
      this.lastAnalysis = t;
      const ev = this._analyse(t);
      if (ev) events.push(...ev);
    }
    return events;
  }

  /** What the screen needs: state, period, and the signal with its thresholds. */
  display() {
    if (this.state === "counting") {
      const L = this.lock;
      return {
        state: this.state, period: L.period, reps: this.current, total: this.total,
        points: L.trace, mid: L.mid, h: L.h,
      };
    }
    return {
      state: this.state, period: this.search?.period ?? null, corr: this.search?.corr ?? null,
      reps: this.current, total: this.total, points: this.search?.points ?? [], mid: null, h: null,
    };
  }

  // ---------------------------------------------------------------- searching

  /**
   * Looks for a rhythm in several look-back windows, shortest first, and keeps the first that has
   * one. A short window sees only the reps; a long one also holds whatever came before (walking
   * back from the phone), which can dominate the main direction of motion for many seconds.
   */
  _analyse(tNow) {
    const o = this.o;
    const usable = this.frames.filter((fr) => fr.t > this.ignoreBefore);
    this.search = null;
    let found = null;
    for (const W of o.windows) {
      if (W < o.lockReps * o.minPeriod) continue;
      const res = this._analyseWindow(usable.filter((fr) => fr.t >= tNow - W), tNow, W);
      if (!res) continue;
      this.search = res.search;            // what the screen shows: the last window looked at
      if (res.found) { found = res; break; }
      if (usable.length && usable[0].t > tNow - W) break; // longer windows hold no more frames
    }
    if (!found) { this.candidates = []; return null; }
    this.candidates.push(found.found.period);
    if (this.candidates.length > o.stableChecks) this.candidates.shift();
    if (this.candidates.length < o.stableChecks) return null;
    const med = median(this.candidates);
    if (this.candidates.some((c) => Math.abs(c - med) > o.periodTolerance * med)) return null;
    return this._tryLock(tNow, found.mean, found.axis, med, found.W);
  }

  _analyseWindow(frames, tNow, W) {
    const o = this.o;
    const grid = resample(frames, o.analysisHz);
    if (!grid || grid.n < o.lockReps * o.minPeriod * o.analysisHz) return null;
    const { n, d, X, t0 } = grid;
    const mean = new Float64Array(d);
    for (let i = 0; i < n; i++) for (let j = 0; j < d; j++) mean[j] += X[i * d + j];
    for (let j = 0; j < d; j++) mean[j] /= n;
    for (let i = 0; i < n; i++) for (let j = 0; j < d; j++) X[i * d + j] -= mean[j];

    const warmKey = `${W}`;
    this._warm = this._warm || {};
    const axis = principalAxis(X, n, d, this._warm[warmKey]);
    this._warm[warmKey] = axis;
    const p = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = 0; j < d; j++) s += X[i * d + j] * axis[j];
      p[i] = s;
    }
    const points = [];
    for (let i = 0; i < n; i++) points.push({ t: t0 + i / o.analysisHz, p: p[i] });
    const search = { points, period: null, corr: null };
    if (std(p) < o.minMotion) return { search, found: null };
    const found = findPeriod(p, o.analysisHz, o.minPeriod, o.maxPeriod, o.lockReps, o.lockCorr);
    if (found) { search.period = found.period; search.corr = found.corr; }
    return { search, found, mean, axis, W };
  }

  _tryLock(tNow, mean, axis, period, W) {
    const o = this.o;
    // Reps already done are counted inside the window the rhythm was found in (plus half a cycle),
    // never in the movement before it.
    const frames = this.frames.filter((fr) => fr.t > this.ignoreBefore && fr.t >= tNow - W - 0.5 * period);
    const L = { mean, axis: Float64Array.from(axis), period, trace: [], armed: false, lastRepT: -Infinity };
    let proj = frames.map((fr) => ({ t: fr.t, p: this._project(fr.f, L) }));

    // Swing size from the last few cycles.
    const recent = proj.filter((q) => q.t >= tNow - o.lockReps * period).map((q) => q.p);
    const lo = percentile(recent, 5), hi = percentile(recent, 95);
    const amp = hi - lo;
    if (amp < Math.max(o.minSwing, 2 * o.minMotion)) return null;
    let mid = (lo + hi) / 2;

    // Sign: the rest position (where the body dwells) should be "high", so the count lands as the
    // body comes back to rest, at the end of each rep.
    const above = recent.filter((x) => x > mid).length;
    if (above < recent.length - above) {
      for (let j = 0; j < L.axis.length; j++) L.axis[j] = -L.axis[j];
      proj = proj.map((q) => ({ t: q.t, p: -q.p }));
      mid = -mid;
    }
    L.mid = mid;
    L.amp = amp;
    L.lockAmp = amp;
    L.h = o.hysteresis * amp;

    // Count the cycles already done, with the same rule used live.
    const times = [];
    for (const q of proj) if (this._step(L, q.t, q.p)) times.push(q.t);
    // Keep only the reps that follow the rhythm: walk back from the newest one and stop at the first
    // gap that does not look like one cycle (a swing from walking into place, say).
    let reps = times.length ? 1 : 0;
    for (let k = times.length - 1; k > 0; k--) {
      const gap = times[k] - times[k - 1];
      if (gap < 0.85 * period || gap > 1.3 * period) break;
      reps += 1;
    }
    L.trace = proj.filter((q) => q.t >= tNow - Math.max(3 * period, 4));
    if (reps < o.lockReps - 1) return null;

    this.lock = L;
    this.state = "counting";
    this.current = reps;
    this.total += reps;
    if (!Number.isFinite(L.lastRepT)) L.lastRepT = tNow;
    return [{ type: "lock", period, reps, total: this.total, t: tNow }];
  }

  // ---------------------------------------------------------------- counting

  _project(f, L) {
    let s = 0;
    for (let j = 0; j < f.length; j++) s += (f[j] - L.mean[j]) * L.axis[j];
    return s;
  }

  /** Hysteresis step. Returns true when this sample completes a rep. */
  _step(L, t, p) {
    if (p < L.mid - L.h) { L.armed = true; return false; }
    if (L.armed && p > L.mid + L.h) {
      if (t - L.lastRepT < 0.4 * L.period) return false; // too fast to be a rep: noise
      const dt = t - L.lastRepT;
      if (dt > 0.6 * L.period && dt < 1.8 * L.period) L.period = 0.75 * L.period + 0.25 * dt;
      L.armed = false;
      L.lastRepT = t;
      return true;
    }
    return false;
  }

  /** Follow slow drifts of the swing (depth, distance to the camera). Frozen when motion stops. */
  _adapt(L, t) {
    const vals = L.trace.filter((q) => q.t >= t - 2.5 * L.period).map((q) => q.p);
    if (vals.length < 5) return;
    const lo = percentile(vals, 5), hi = percentile(vals, 95);
    const amp = hi - lo;
    if (amp < 0.5 * L.lockAmp) return;
    L.mid = 0.7 * L.mid + 0.3 * (lo + hi) / 2;
    L.amp = 0.7 * L.amp + 0.3 * amp;
    L.h = this.o.hysteresis * L.amp;
  }
}

// ------------------------------------------------------------------ helpers (exported for tests)

/** Linear resampling of {t, f} frames to a uniform grid. Returns {n, d, X (row-major), t0}. */
export function resample(frames, hz) {
  if (frames.length < 2) return null;
  const d = frames[0].f.length;
  const t0 = frames[0].t, t1 = frames[frames.length - 1].t;
  const n = Math.floor((t1 - t0) * hz) + 1;
  if (n < 2) return null;
  const X = new Float64Array(n * d);
  let k = 0;
  for (let i = 0; i < n; i++) {
    const t = t0 + i / hz;
    while (k < frames.length - 2 && frames[k + 1].t < t) k++;
    const a = frames[k], b = frames[k + 1];
    const w = b.t > a.t ? Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))) : 0;
    for (let j = 0; j < d; j++) X[i * d + j] = a.f[j] + w * (b.f[j] - a.f[j]);
  }
  return { n, d, X, t0 };
}

/** First principal axis of centred rows, by power iteration on X^T X (without forming it). */
export function principalAxis(X, n, d, warm) {
  let v = new Float64Array(d);
  if (warm && warm.length === d) v.set(warm);
  else for (let j = 0; j < d; j++) v[j] = 1 + 0.37 * Math.sin(1.7 * j + 0.3);
  normalise(v);
  const u = new Float64Array(n);
  for (let it = 0; it < 40; it++) {
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = 0; j < d; j++) s += X[i * d + j] * v[j];
      u[i] = s;
    }
    const w = new Float64Array(d);
    for (let i = 0; i < n; i++) {
      const ui = u[i];
      if (ui === 0) continue;
      for (let j = 0; j < d; j++) w[j] += X[i * d + j] * ui;
    }
    if (!normalise(w)) return v;
    let change = 0;
    for (let j = 0; j < d; j++) change += Math.abs(w[j] - v[j]);
    v = w;
    if (change < 1e-6) break;
  }
  return v;
}

/**
 * Period of a 1-D signal from its autocorrelation (Pearson at each lag).
 * Picks the shortest strong peak, so a multiple of the true period is not taken instead.
 */
export function findPeriod(p, hz, minPeriod, maxPeriod, minCycles, minCorr) {
  const n = p.length;
  const minLag = Math.max(2, Math.round(minPeriod * hz));
  const maxLag = Math.min(Math.round(maxPeriod * hz), Math.floor(n / minCycles));
  if (maxLag <= minLag + 1) return null;
  const r = new Float64Array(maxLag + 2);
  for (let L = minLag - 1; L <= maxLag + 1; L++) r[L] = pearsonLag(p, L);
  const peaks = [];
  for (let L = minLag; L <= maxLag; L++) {
    if (r[L] >= r[L - 1] && r[L] >= r[L + 1] && r[L] > 0) peaks.push(L);
  }
  if (!peaks.length) return null;
  const best = Math.max(...peaks.map((L) => r[L]));
  if (best < minCorr) return null;
  const L = peaks.find((k) => r[k] >= 0.85 * best);
  // A real back-and-forth is anti-correlated with itself half a cycle later. A slow drift is not,
  // even though it can correlate well at a long lag.
  let trough = Infinity;
  for (let k = Math.max(1, Math.round(L / 4)); k <= Math.round((3 * L) / 4); k++) trough = Math.min(trough, pearsonLag(p, k));
  if (trough > -0.2) return null;
  // Parabolic refinement of the peak position.
  const a = r[L - 1], b = r[L], c = r[L + 1];
  const den = a - 2 * b + c;
  const shift = den < 0 ? Math.max(-0.5, Math.min(0.5, 0.5 * (a - c) / den)) : 0;
  return { period: (L + shift) / hz, corr: r[L] };
}

function pearsonLag(p, L) {
  const m = p.length - L;
  if (m < 3) return 0;
  let sx = 0, sy = 0;
  for (let i = 0; i < m; i++) { sx += p[i]; sy += p[i + L]; }
  const mx = sx / m, my = sy / m;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < m; i++) {
    const x = p[i] - mx, y = p[i + L] - my;
    sxy += x * y; sxx += x * x; syy += y * y;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
}

function normalise(v) {
  let s = 0;
  for (let j = 0; j < v.length; j++) s += v[j] * v[j];
  s = Math.sqrt(s);
  if (!(s > 0)) return false;
  for (let j = 0; j < v.length; j++) v[j] /= s;
  return true;
}

function std(a) {
  let m = 0;
  for (const x of a) m += x;
  m /= a.length;
  let s = 0;
  for (const x of a) s += (x - m) * (x - m);
  return Math.sqrt(s / a.length);
}

export function percentile(a, q) {
  if (!a.length) return 0;
  const s = Array.from(a).sort((x, y) => x - y);
  const pos = (q / 100) * (s.length - 1);
  const i = Math.floor(pos), f = pos - i;
  return i + 1 < s.length ? s[i] + f * (s[i + 1] - s[i]) : s[i];
}

function median(a) {
  return percentile(a, 50);
}
