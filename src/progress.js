// Adherence and progression, from the session log. No browser APIs, so it is tested in Node
// (tests/progress.test.mjs).
//
// Short term: this week's sessions and volume against the plan.
// Long term: clean weeks (see CLEAN_DEFAULTS in program.js), weeks in a row on target, the last
// four weeks, pain over time, and the next step in the program, which is only ever suggested:
// the user confirms it.

import { addDays, weekOf, plannedInWeek, programWeek, daysBetween } from "./program.js";
import { sessionVolume } from "./session.js";

/** Sessions of this program since it was started. */
export function programSessions(program, progress, sessions) {
  return sessions.filter((s) => s.programId === program.id && s.day >= progress.startDay);
}

/**
 * One week (Monday `week`) of a program. `complete` once the week is over; `clean` is then
 * true or false, with the reasons it is not; before that it is null.
 */
export function weekSummary(program, progress, sessions, week, today) {
  const c = program.clean;
  const end = addDays(week, 6);
  const mine = programSessions(program, progress, sessions).filter((s) => s.day >= week && s.day <= end);
  const planned = plannedInWeek(program, progress, week);
  let done = 0, plannedReps = 0;
  for (const s of mine) {
    const v = sessionVolume(s);
    done += v.done;
    plannedReps += v.planned;
  }
  // Planned volume for the whole week: the sessions done plus, for each one missed, the volume of
  // an average session done (or of the stage, when none was done).
  const perSession = mine.length ? plannedReps / mine.length : stageReps(program, progress);
  const weekReps = plannedReps + Math.max(0, planned - mine.length) * perSession;
  const pains = mine.map((s) => s.pain).filter((p) => p != null);
  const mornings = mine.map((s) => s.morning).filter((m) => m != null);
  const sum = {
    week, planned, sessions: mine.length, extra: Math.max(0, mine.length - planned),
    volumePct: weekReps ? Math.round((100 * done) / weekReps) : (planned ? 0 : 100),
    reps: done, plannedReps: Math.round(weekReps),
    maxPain: pains.length ? Math.max(...pains) : null,
    worse: mornings.filter((m) => m === "bit" || m === "yes").length,
    complete: end < today, clean: null, reasons: [],
  };
  if (!sum.complete || planned === 0) return sum;
  const r = sum.reasons;
  if (mine.length < Math.ceil((planned * c.sessionsPct) / 100)) r.push("sessions");
  if (sum.volumePct < c.volumePct) r.push("volume");
  if (program.checkins.pain && sum.maxPain != null && sum.maxPain > c.maxPain) r.push("pain");
  if (program.checkins.morning && c.noWorseMornings && sum.worse) r.push("morning");
  if (c.noExtraSessions && sum.extra) r.push("extra");
  sum.clean = r.length === 0;
  return sum;
}

function stageReps(program, progress) {
  const st = program.stages[Math.min(progress.stage, program.stages.length - 1)];
  return st.steps.reduce((a, s) => a + (s.type === "exercise" ? s.sets * s.reps * (s.sides ? 2 : 1) : 0), 0);
}

/** Every week from the start to this one, newest first, with the long-term figures. */
export function overview(program, progress, sessions, today) {
  const weeks = [];
  for (let w = weekOf(today); w >= weekOf(progress.startDay); w = addDays(w, -7)) {
    weeks.push(weekSummary(program, progress, sessions, w, today));
  }
  const judged = weeks.filter((w) => w.complete && w.planned > 0);
  let streak = 0;
  for (const w of judged) { if (!w.clean) break; streak += 1; }
  // Toward the next step: clean weeks in a row that began on or after the last change.
  let towardNext = 0;
  for (const w of judged) { if (w.week < progress.since || !w.clean) break; towardNext += 1; }
  const last4 = judged.slice(0, 4);
  const plan4 = last4.reduce((a, w) => a + w.planned, 0);
  const done4 = last4.reduce((a, w) => a + Math.min(w.sessions, w.planned), 0);
  return {
    week: programWeek(progress, today), weeks, streak, towardNext,
    last4: { weeks: last4.length, clean: last4.filter((w) => w.clean).length, sessionsPct: plan4 ? Math.round((100 * done4) / plan4) : null },
  };
}

/**
 * The next step to suggest, or null:
 *   {type: "reduce", why: "pain" | "morning"}   symptoms went up: ease off
 *   {type: "advance", to}                       clean weeks done and the calendar allows the next stage
 *   {type: "load"}                              clean weeks done in a stage that progresses by weight
 * A suggestion put off ("Not now") stays away until the next week.
 */
export function suggestion(program, progress, sessions, today) {
  const c = program.clean;
  const mine = programSessions(program, progress, sessions).filter((s) => daysBetween(s.day, today) <= 7);
  const last = mine.sort((a, b) => (a.start < b.start ? 1 : -1))[0];
  const snoozed = progress.snoozed && progress.snoozed >= weekOf(today);
  if (last && !(progress.eased && progress.eased >= last.id)) {
    if (program.checkins.pain && last.pain != null && last.pain > c.maxPain) return { type: "reduce", why: "pain", session: last.id };
    if (program.checkins.morning && (last.morning === "yes" || last.morning === "bit")) return { type: "reduce", why: "morning", session: last.id };
  }
  if (snoozed) return null;
  const o = overview(program, progress, sessions, today);
  if (o.towardNext < c.weeksToAdvance) return null;
  const next = program.stages[progress.stage + 1];
  if (next && o.week >= next.fromWeek) return { type: "advance", to: progress.stage + 1 };
  if (program.stages[progress.stage]?.loadProgression) return { type: "load" };
  return null;
}

/** The user said yes to a suggestion: the new progress. */
export function accept(progress, sug, today) {
  if (sug.type === "advance") return { ...progress, stage: sug.to, since: today, snoozed: null };
  if (sug.type === "load") return { ...progress, since: today, snoozed: null };
  if (sug.type === "reduce") return { ...progress, eased: sug.session, since: today };
  return progress;
}

/** "Not now". */
export function snooze(progress, sug, today) {
  if (sug.type === "reduce") return { ...progress, eased: sug.session };
  return { ...progress, snoozed: weekOf(today) };
}

/** The session the morning question is about: the latest one from yesterday or the day before, unanswered. */
export function pendingMorning(program, progress, sessions, today) {
  if (!program?.checkins.morning) return null;
  const cand = programSessions(program, progress, sessions)
    .filter((s) => s.day <= today && daysBetween(s.day, today) <= 2)
    .sort((a, b) => (a.start < b.start ? 1 : -1))[0];
  return cand && cand.day < today && cand.morning == null ? cand : null;
}
