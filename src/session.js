// A session as it happens and as it is logged. No browser APIs, so it is tested in Node
// (tests/session.test.mjs).
//
// Guided: the steps of today's plan are walked in order. Each counted set fills the next slot of
// the current exercise (for a one-side exercise the slots alternate left, right); a timer step is
// one slot. Skipping leaves a slot empty, which counts as missing volume.
// Free: no program, just the sets the counter found.
//
// Logged record:
//   {id, start, end, day, programId, programName, stage, stageName, planned, unit,
//    steps: [{type, name, sets, reps, sides, tempo, weight, minutes, done: [{reps, sec, side, rest}]}],
//    pain, morning, unfinished}

export class GuidedSession {
  /**
   * plan: {programId, programName, stage, stageName, planned, unit, steps, weights}
   * `weights` maps exercise names to the weight the user set for today.
   */
  constructor(plan, start, id = newId(start)) {
    this.id = id;
    this.start = start;            // ISO time
    this.plan = plan;
    this.steps = plan.steps.map((s) => ({
      ...s, done: [], pos: 0,
      ...(s.type === "exercise" && s.weight ? { weight: plan.weights?.[s.name] ?? null } : {}),
    }));
    this.i = 0;
    this._skipDone();
  }

  get finished() { return this.i >= this.steps.length; }
  get step() { return this.steps[this.i] ?? null; }

  /** The slot being worked on: {step, set (1-based), of, side, target, next}. */
  slot() {
    const s = this.step;
    if (!s) return null;
    const next = this.steps[this.i + 1] ?? null;
    if (s.type === "timer") return { step: s, set: 1, of: 1, side: null, target: null, next };
    const per = s.sides ? 2 : 1;
    return {
      step: s, set: Math.floor(s.pos / per) + 1, of: s.sets,
      side: s.sides ? (s.pos % 2 ? "right" : "left") : null, target: s.reps, next,
    };
  }

  /**
   * A set was counted. Returns what changed: {stepChanged, finished}.
   * Sets counted during a timer step (walking, for example) are ignored.
   */
  recordSet(reps, sec = null, rest = null) {
    const s = this.step;
    if (!s || s.type !== "exercise" || reps < 1) return { stepChanged: false, finished: this.finished, ignored: true };
    const side = this.slot().side;
    s.done.push({ reps, sec: sec ?? null, ...(side ? { side } : {}), ...(rest != null ? { rest } : {}) });
    return this._advance();
  }

  /** Moves past the current slot (a set not done, or the timer finished). */
  skip() {
    if (!this.step) return { stepChanged: false, finished: true };
    return this._advance();
  }

  /** Jumps to the next step, leaving the rest of this one undone. */
  skipStep() {
    if (!this.step) return { stepChanged: false, finished: true };
    this.step.pos = slots(this.step);
    return this._advance(true);
  }

  _advance(already = false) {
    const s = this.step;
    if (!already) s.pos += 1;
    if (s.pos < slots(s)) return { stepChanged: false, finished: false };
    this.i += 1;
    this._skipDone();
    return { stepChanged: true, finished: this.finished };
  }

  _skipDone() {
    while (this.step && this.step.pos >= slots(this.step)) this.i += 1;
  }

  /** The record to log. `unfinished` marks a session saved without the user finishing it. */
  record({ end, day, pain = null, unfinished = false }) {
    const p = this.plan;
    return {
      id: this.id, start: this.start, end, day,
      programId: p.programId, programName: p.programName, stage: p.stage, stageName: p.stageName,
      planned: !!p.planned, unit: p.unit ?? "",
      steps: this.steps.map(({ pos, ...s }) => ({ ...s, ...(s.type === "timer" ? { doneTimer: pos > 0 } : {}) })),
      pain, morning: null, ...(unfinished ? { unfinished: true } : {}),
    };
  }

  /** Back from a saved draft. */
  static restore(draft) {
    const g = new GuidedSession(draft.plan, draft.start, draft.id);
    draft.steps.forEach((s, k) => Object.assign(g.steps[k], { done: s.done, pos: s.pos, weight: s.weight }));
    g.i = draft.i;
    return g;
  }

  draft() {
    return { kind: "guided", id: this.id, start: this.start, plan: this.plan, i: this.i, steps: this.steps };
  }
}

function slots(s) {
  return s.type === "timer" ? 1 : s.sets * (s.sides ? 2 : 1);
}

/** A free session (no program): the sets as the counter found them. */
export function freeRecord({ id, start, end, day, sets, rests = [] }) {
  return {
    id: id ?? newId(start), start, end, day, programId: null, programName: "", stage: null, stageName: "",
    planned: false, unit: "",
    steps: [{ type: "exercise", name: "", sets: sets.length, reps: null, free: true,
      done: sets.map((s, k) => ({ reps: s.reps, sec: s.sec ?? null, ...(k > 0 && rests[k - 1] != null ? { rest: rests[k - 1] } : {}) })) }],
    pain: null, morning: null,
  };
}

/** Average seconds per rep from the times the reps were counted. */
export function avgRepSeconds(times) {
  if (!times || times.length < 2) return null;
  return (times.at(-1) - times[0]) / (times.length - 1);
}

/** Live tempo advice: "slower" when reps are clearly faster than the target. */
export function tempoAdvice(period, target) {
  if (!target || !period) return null;
  return period < 0.8 * target ? "slower" : null;
}

/** Reps done and planned in a session, done capped per slot so extra reps do not hide missing ones. */
export function sessionVolume(rec) {
  let done = 0, planned = 0, total = 0;
  for (const s of rec.steps) {
    if (s.type !== "exercise") continue;
    for (const d of s.done) total += d.reps;
    if (s.free) continue;
    planned += s.sets * s.reps * (s.sides ? 2 : 1);
    for (const d of s.done) done += Math.min(d.reps, s.reps);
  }
  return { done, planned, total };
}

export function newId(start) {
  return `${String(start).replace(/[^0-9]/g, "").slice(0, 14)}-${Math.random().toString(36).slice(2, 8)}`;
}
