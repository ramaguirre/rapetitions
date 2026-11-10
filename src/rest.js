// Rest timer between sets. No browser APIs, so it is tested in Node (tests/rest.test.mjs).
//
// Rest runs from the last rep of a set to the start of the next one. The counter only closes a set
// a few seconds after the last rep, and only notices the next set after a few reps, so both ends
// are set from what the counter reports, not from when the events arrive.

export class RestTimer {
  constructor() {
    this.reset();
  }

  reset() {
    this.since = null;  // start of the current rest (seconds, counter clock), or null
    this.spoken = 0;    // whole minutes already announced in this rest
    this.rests = [];    // finished rests, seconds
  }

  get resting() {
    return this.since !== null;
  }

  /** A set ended; `lastRepT` is the time of its last rep. */
  start(lastRepT) {
    this.since = lastRepT;
    this.spoken = 0;
  }

  /**
   * The next set started: the counter locked at `t` with `reps` already done at `period` s each,
   * so the set began about reps x period earlier. Returns the rest length in seconds, or null.
   */
  stop(t, reps = 0, period = 0) {
    if (!this.resting) return null;
    const end = Math.max(this.since, t - reps * period);
    const length = end - this.since;
    this.rests.push(length);
    this.since = null;
    return length;
  }

  elapsed(t) {
    return this.resting ? Math.max(0, t - this.since) : 0;
  }

  /** Call often (every second). Returns the whole minute just reached (1, 2, ...) or 0. */
  tick(t) {
    if (!this.resting) return 0;
    const minutes = Math.floor(this.elapsed(t) / 60);
    if (minutes > this.spoken) {
      this.spoken = minutes;
      return minutes;
    }
    return 0;
  }
}

/** 83 -> "1:23". */
export function clock(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
