// Node tests for programs, guided sessions, adherence and progression.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ACHILLES, TEMPLATES, CLEAN_DEFAULTS, normalizeProgram, addDays, weekday, weekOf, programWeek,
  plannedInWeek, todayPlan, startProgress, plannedReps, dayKey,
} from "../src/program.js";
import { GuidedSession, freeRecord, avgRepSeconds, tempoAdvice, sessionVolume } from "../src/session.js";
import { weekSummary, overview, suggestion, accept, snooze, pendingMorning } from "../src/progress.js";

const A = normalizeProgram(ACHILLES);
const MON = "2026-11-02"; // a Monday

// A full session of today's plan for program `p`, every set done as planned unless `reps` says otherwise.
function doSession(p, progress, day, { reps = null, pain = 1, morning = "no", skipLast = false } = {}) {
  const plan = todayPlan(p, progress, day);
  const g = new GuidedSession({ programId: p.id, programName: p.name, stage: plan.stageIndex,
    stageName: plan.stage.name, planned: plan.planned, unit: p.unit, steps: plan.steps, weights: progress.weights }, `${day}T18:00:00`);
  while (!g.finished) {
    const sl = g.slot();
    if (sl.step.type === "timer") { g.skip(); continue; }
    if (skipLast && g.i === g.steps.length - 1) { g.skip(); continue; }
    g.recordSet(reps ?? sl.target, 6);
  }
  return { ...g.record({ end: `${day}T18:25:00`, day, pain }), morning };
}

test("calendar helpers", () => {
  assert.equal(weekday(MON), 1);
  assert.equal(weekday("2026-11-08"), 7);
  assert.equal(weekOf("2026-11-08"), MON);
  assert.equal(weekOf(MON), MON);
  assert.equal(addDays("2026-10-31", 1), "2026-11-01");
  assert.equal(addDays("2026-03-28", 2), "2026-03-30", "no slip across a clock change");
  assert.equal(dayKey(new Date(2026, 0, 5, 23, 30)), "2026-01-05");
  const pr = startProgress(A, "2026-11-04");
  assert.equal(programWeek(pr, "2026-11-08"), 1);
  assert.equal(programWeek(pr, "2026-11-09"), 2);
});

test("the templates are valid programs", () => {
  for (const t of TEMPLATES) {
    const p = normalizeProgram(t);
    assert.ok(p.stages.length > 0);
    assert.deepEqual(normalizeProgram(JSON.parse(JSON.stringify(p))), p, "a program survives a file round trip");
  }
  assert.deepEqual(A.days, [1, 3, 5]);
  assert.equal(A.clean.weeksToAdvance, 2);
  assert.deepEqual(A.stages.map((s) => s.fromWeek), [1, 3, 5, 7, 11]);
});

test("bad programs are refused with a reason", () => {
  const bad = (p, re) => assert.throws(() => normalizeProgram(p), re);
  bad(null, /Not a program/);
  bad({ format: "other" }, /Not a RApetitions/);
  bad({ name: "" }, /no name/);
  bad({ name: "x", days: [8], stages: [] }, /Days/);
  bad({ name: "x", days: [1], stages: [] }, /no stages/);
  bad({ name: "x", days: [], perWeek: 0, stages: [{ steps: [] }] }, /how many/);
  bad({ name: "x", days: [1], stages: [{ steps: [{ name: "a", sets: 0, reps: 5 }] }] }, /Sets/);
  bad({ name: "x", days: [1], stages: [{ steps: [{ name: "a", sets: 3, reps: 5, tempo: 30 }] }] }, /Tempo/);
});

test("a general program: any days, any number of sessions", () => {
  const p = normalizeProgram({ name: "Push-ups", days: [], perWeek: 4, stages: [{ steps: [{ name: "Push-ups", sets: 5, reps: 10 }] }] });
  const pr = startProgress(p, MON);
  assert.equal(plannedInWeek(p, pr, MON), 4);
  assert.equal(todayPlan(p, pr, "2026-11-05", 3).planned, true);
  assert.equal(todayPlan(p, pr, "2026-11-06", 4).planned, false, "four done: the rest of the week is rest");
  assert.deepEqual(p.clean, CLEAN_DEFAULTS);
  assert.deepEqual(p.checkins, { pain: false, painQuestion: "", morning: false, morningQuestion: "" });
});

test("the first week counts from the start day", () => {
  const pr = startProgress(A, "2026-11-04"); // Wednesday
  assert.equal(plannedInWeek(A, pr, MON), 2);
  assert.equal(plannedInWeek(A, pr, addDays(MON, 7)), 3);
  assert.equal(plannedInWeek(A, pr, addDays(MON, -7)), 0);
});

test("guided session: steps in order, sides alternate, timer sets ignored", () => {
  const p = normalizeProgram({ ...ACHILLES, stages: [ACHILLES.stages[2]] });
  const plan = todayPlan(p, startProgress(p, MON), MON);
  const g = new GuidedSession({ programId: p.id, steps: plan.steps, weights: { "Seated calf raises": 8 } }, `${MON}T18:00:00`);
  assert.equal(g.slot().step.type, "timer");
  assert.equal(g.recordSet(9, 1).ignored, true, "steps while walking are not reps");
  assert.equal(g.skip().stepChanged, true);
  assert.deepEqual([g.slot().step.name, g.slot().set, g.slot().of, g.slot().target], ["Standing calf raises", 1, 3, 12]);
  g.recordSet(12, 6.1); g.recordSet(11, 5.9);
  assert.equal(g.recordSet(12, 6).stepChanged, true);
  assert.equal(g.step.weight, 8, "today's weight is kept with the exercise");
  g.skipStep();
  const sides = [];
  while (!g.finished) { sides.push(`${g.slot().set}${g.slot().side[0]}`); g.recordSet(8, 4); }
  assert.deepEqual(sides, ["1l", "1r", "2l", "2r"]);
  const rec = g.record({ end: `${MON}T18:20:00`, day: MON, pain: 2 });
  assert.equal(rec.steps[0].doneTimer, true);
  assert.deepEqual(rec.steps[1].done.map((d) => d.reps), [12, 11, 12]);
  assert.deepEqual(rec.steps[3].done.map((d) => d.side), ["left", "right", "left", "right"]);
  // Volume: 35 of 36 standing, 0 of 36 seated (skipped), 32 of 32 single-leg.
  assert.deepEqual(sessionVolume(rec), { done: 67, planned: 104, total: 67 });
});

test("a session in progress survives a reload", () => {
  const plan = todayPlan(A, startProgress(A, MON), MON);
  const g = new GuidedSession({ programId: A.id, steps: plan.steps }, `${MON}T18:00:00`);
  g.skip(); g.recordSet(12, 6);
  const back = GuidedSession.restore(JSON.parse(JSON.stringify(g.draft())));
  assert.deepEqual([back.slot().step.name, back.slot().set], ["Standing calf raises", 2]);
  assert.equal(back.id, g.id);
  back.recordSet(12, 6);
  assert.equal(back.steps[1].done.length, 2);
});

test("extra reps do not make up for missing ones", () => {
  const rec = { steps: [{ type: "exercise", sets: 2, reps: 10, done: [{ reps: 20 }] }] };
  assert.deepEqual(sessionVolume(rec), { done: 10, planned: 20, total: 20 });
});

test("free sessions, rep time and tempo", () => {
  const r = freeRecord({ start: "2026-11-02T10:00:00", end: "2026-11-02T10:10:00", day: MON, sets: [{ reps: 10, sec: 2 }, { reps: 8 }], rests: [65] });
  assert.equal(r.programId, null);
  assert.deepEqual(r.steps[0].done, [{ reps: 10, sec: 2 }, { reps: 8, sec: null, rest: 65 }]);
  assert.deepEqual(sessionVolume(r), { done: 0, planned: 0, total: 18 });
  assert.equal(avgRepSeconds([10, 16, 22, 28]), 6);
  assert.equal(avgRepSeconds([10]), null);
  assert.equal(tempoAdvice(4.2, 6), "slower");
  assert.equal(tempoAdvice(5.5, 6), null);
  assert.equal(tempoAdvice(2, undefined), null);
});

test("week summary: frequency, volume, pain, mornings", () => {
  const pr = startProgress(A, MON);
  const s = [doSession(A, pr, MON), doSession(A, pr, "2026-11-04", { reps: 10, pain: 4 })];
  const mid = weekSummary(A, pr, s, MON, "2026-11-05");
  assert.equal(mid.complete, false);
  assert.equal(mid.clean, null, "a week is judged once it is over");
  assert.deepEqual([mid.planned, mid.sessions], [3, 2]);
  const done = weekSummary(A, pr, s, MON, "2026-11-09");
  assert.equal(done.clean, false);
  assert.deepEqual(done.reasons, ["sessions", "volume", "pain"]);
  assert.equal(done.volumePct, Math.round((100 * (72 + 60)) / (72 * 3)));
  assert.equal(done.maxPain, 4);
});

test("clean weeks, streak, the next stage only when the calendar allows", () => {
  let pr = startProgress(A, MON);
  const log = [];
  const week = (w, opts) => { for (const d of [0, 2, 4]) log.push(doSession(A, pr, addDays(w, d), opts)); };
  week(MON); week(addDays(MON, 7));
  // Two clean weeks, but stage 2 starts in week 3: nothing until then.
  assert.equal(suggestion(A, pr, log, addDays(MON, 13)), null);
  const o = overview(A, pr, log, addDays(MON, 14));
  assert.deepEqual([o.week, o.streak, o.towardNext], [3, 2, 2]);
  assert.deepEqual(o.last4, { weeks: 2, clean: 2, sessionsPct: 100 });
  const sug = suggestion(A, pr, log, addDays(MON, 14));
  assert.deepEqual(sug, { type: "advance", to: 1 });
  // "Not now" waits for the next week.
  const later = snooze(pr, sug, addDays(MON, 14));
  assert.equal(suggestion(A, later, log, addDays(MON, 16)), null);
  week(addDays(MON, 14));
  assert.deepEqual(suggestion(A, later, log, addDays(MON, 21)), { type: "advance", to: 1 });
  assert.equal(suggestion(A, later, log.slice(0, 6), addDays(MON, 21)), null, "a week missed starts the count again");
  // Accepted: stage 2, and the count starts again.
  pr = accept(pr, sug, addDays(MON, 14));
  assert.equal(pr.stage, 1);
  assert.equal(overview(A, pr, log, addDays(MON, 14)).towardNext, 0);
  assert.equal(overview(A, pr, log, addDays(MON, 14)).streak, 2, "the streak goes on across stages");
});

test("a week with an extra session or a worse morning is not clean", () => {
  const pr = startProgress(A, MON);
  const log = [0, 2, 4].map((d) => doSession(A, pr, addDays(MON, d)));
  assert.equal(weekSummary(A, pr, log, MON, addDays(MON, 7)).clean, true);
  const extra = [...log, doSession(A, pr, addDays(MON, 5))];
  assert.deepEqual(weekSummary(A, pr, extra, MON, addDays(MON, 7)).reasons, ["extra"]);
  const worse = log.map((s, i) => (i === 1 ? { ...s, morning: "bit" } : s));
  assert.deepEqual(weekSummary(A, pr, worse, MON, addDays(MON, 7)).reasons, ["morning"]);
  // Editable: a program that allows extra sessions.
  const relaxed = { ...A, clean: { ...A.clean, noExtraSessions: false } };
  assert.equal(weekSummary(relaxed, pr, extra, MON, addDays(MON, 7)).clean, true);
});

test("symptoms up: suggest easing off, once per session", () => {
  const pr = startProgress(A, MON);
  const log = [doSession(A, pr, MON, { pain: 5 })];
  const sug = suggestion(A, pr, log, addDays(MON, 1));
  assert.equal(sug.type, "reduce");
  assert.equal(sug.why, "pain");
  assert.equal(suggestion(A, snooze(pr, sug, addDays(MON, 1)), log, addDays(MON, 1)), null);
  const log2 = [{ ...doSession(A, pr, MON), morning: "yes" }];
  assert.equal(suggestion(A, pr, log2, addDays(MON, 1)).why, "morning");
});

test("a stage that progresses by weight suggests adding weight", () => {
  const p = normalizeProgram({ name: "Squats", days: [2, 4], stages: [{ loadProgression: true, steps: [{ name: "Squat", sets: 3, reps: 8, weight: true }] }] });
  const pr = startProgress(p, MON);
  const log = [1, 3, 8, 10].map((d) => doSession(p, pr, addDays(MON, d)));
  assert.deepEqual(suggestion(p, pr, log, addDays(MON, 14)), { type: "load" });
  assert.equal(suggestion(p, accept(pr, { type: "load" }, addDays(MON, 14)), log, addDays(MON, 15)), null);
});

test("morning check-in: the last session, the next day, once", () => {
  const pr = startProgress(A, MON);
  const s = { ...doSession(A, pr, MON), morning: null };
  assert.equal(pendingMorning(A, pr, [s], MON), null, "not on the same day");
  assert.equal(pendingMorning(A, pr, [s], addDays(MON, 1)).id, s.id);
  assert.equal(pendingMorning(A, pr, [{ ...s, morning: "no" }], addDays(MON, 1)), null);
  assert.equal(pendingMorning(A, pr, [s], addDays(MON, 4)), null, "too late to ask");
  const plain = normalizeProgram({ name: "x", days: [1], stages: [{ steps: [{ name: "a", sets: 1, reps: 1 }] }] });
  assert.equal(pendingMorning(plain, pr, [s], addDays(MON, 1)), null, "only when the program asks");
});

test("planned reps of a stage", () => {
  assert.equal(plannedReps(A.stages[0].steps), 72);
  assert.equal(plannedReps(A.stages[2].steps), 72 + 32);
});

test("backup: round trip, merge by id, bad files refused", async () => {
  const { makeBackup, readBackup, newSessions, programFile } = await import("../src/backup.js");
  const pr = startProgress(A, MON);
  const log = [doSession(A, pr, MON), doSession(A, pr, addDays(MON, 2))];
  const file = JSON.parse(JSON.stringify(makeBackup({ program: A, progress: pr, sessions: log, exported: "2026-11-05T10:00:00Z" })));
  const back = readBackup(file);
  assert.deepEqual(back.program, A);
  assert.deepEqual(back.sessions, log);
  assert.equal(back.skipped, 0);
  assert.deepEqual(newSessions([log[0]], back.sessions).map((s) => s.id), [log[1].id]);
  assert.throws(() => readBackup({ format: "x" }), /Not a RApetitions backup/);
  assert.equal(readBackup({ ...file, sessions: [...file.sessions, { id: 3 }] }).skipped, 1);
  assert.deepEqual(normalizeProgram(JSON.parse(programFile(A))), A);
});
