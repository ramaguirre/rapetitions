// Training programs: the format, the built-in templates and the calendar. No browser APIs, so it is
// tested in Node (tests/program.test.mjs). The app is not tied to any one program: a program is
// data in this format, loaded from a template or from a file someone shares.
//
// A program:
//   name, about        text written by its author (any language)
//   days               planned weekdays, 1 = Monday ... 7 = Sunday; or [] with perWeek = n (any days)
//   unit               weight unit shown next to weights ("kg", "lb")
//   rules              reminders shown with the program; the app does not check them
//   checkins           {pain, painQuestion, morning, morningQuestion}: optional questions
//   clean              what makes a week "clean" (editable, see CLEAN_DEFAULTS)
//   stages             [{name, fromWeek, note, loadProgression, steps}], in order
//   step               {type: "timer", name, minutes} or
//                      {type: "exercise", name, sets, reps, tempo (s per rep), sides, weight, rest (s), note}
//
// Progress (the user's place in a program): {startDay, stage, since, weights, snoozed}.
// Days are local calendar days written "YYYY-MM-DD"; weeks run Monday to Sunday.

export const FORMAT = "rapetitions-program";

export const CLEAN_DEFAULTS = {
  sessionsPct: 100,     // planned sessions done, at least this share
  volumePct: 100,       // planned reps done, at least this share (extra reps do not make up for missing ones)
  maxPain: 3,           // highest session pain allowed (0-10), when the program asks for pain
  noWorseMornings: true, // no "worse" answer the morning after, when the program asks
  noExtraSessions: true, // no more sessions than planned (rest days are rest)
  weeksToAdvance: 2,    // clean weeks in a row before the next step is suggested
};

const ACHILLES_STEPS = (single) => [
  { type: "timer", name: "Easy walking (warm-up)", minutes: 5 },
  { type: "exercise", name: "Standing calf raises", sets: 3, reps: 12, tempo: 6, weight: true,
    note: "Both legs. 3 seconds up, 3 seconds down. Add dumbbells when bodyweight becomes easy." },
  { type: "exercise", name: "Seated calf raises", sets: 3, reps: 12, weight: true,
    note: "Dumbbell across thighs. Slow, controlled movement." },
  ...(single ? [{ type: "exercise", name: "Single-leg calf raises", sets: single[0], reps: single[1], sides: true, weight: true,
    note: "Add weight gradually." }] : []),
];

export const ACHILLES = {
  format: FORMAT, version: 1, id: "achilles-rehab-12w",
  name: "Achilles rehabilitation",
  about: "Restore Achilles tendon strength and load tolerance through consistent progressive resistance. " +
    "20-25 minutes, on a flat floor (no step).",
  days: [1, 3, 5], perWeek: 3, unit: "kg",
  rules: [
    "Keep pain tolerable (ideally 3/10 or less).",
    "No worsening the following morning.",
    "Reduce resistance if symptoms increase.",
    "No calf stretching or heel drops below floor level.",
    "No running, jumping or relevé during initial rehabilitation.",
    "No additional calf workouts on rest days.",
  ],
  checkins: {
    pain: true, painQuestion: "Achilles pain during this session (0 = none, 10 = worst)",
    morning: true, morningQuestion: "Is your Achilles worse this morning than before your last session?",
  },
  clean: { ...CLEAN_DEFAULTS },
  stages: [
    { name: "Establish tolerance", fromWeek: 1, steps: ACHILLES_STEPS(null),
      note: "Bodyweight. Find a level you tolerate." },
    { name: "Increase resistance", fromWeek: 3, loadProgression: true, steps: ACHILLES_STEPS(null),
      note: "Add dumbbells to the standing raises when bodyweight becomes easy." },
    { name: "Introduce single-leg work", fromWeek: 5, steps: ACHILLES_STEPS([2, 8]),
      note: "Only if the two-leg raises are well tolerated." },
    { name: "Heavier resistance", fromWeek: 7, loadProgression: true, steps: ACHILLES_STEPS([3, 12]),
      note: "Single-leg up to 3 x 12; add weight gradually." },
    { name: "Consider hopping", fromWeek: 11, loadProgression: true, steps: ACHILLES_STEPS([3, 12]),
      note: "Hopping only if symptoms and strength permit; the app does not count hops yet." },
  ],
};

export const TEMPLATES = [ACHILLES];

// ------------------------------------------------------------------ format

/**
 * Checks a program (from a template, a file or the editor) and fills in defaults.
 * Throws an Error whose message says what is wrong.
 */
export function normalizeProgram(raw) {
  const fail = (m) => { throw new Error(m); };
  if (!raw || typeof raw !== "object") fail("Not a program");
  if (raw.format !== undefined && raw.format !== FORMAT) fail("Not a RApetitions program");
  const name = String(raw.name ?? "").trim() || fail("The program has no name");
  const days = [...new Set((raw.days ?? []).map(Number))].sort();
  if (days.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) fail("Days must be 1 (Monday) to 7 (Sunday)");
  const perWeek = days.length || Number(raw.perWeek);
  if (!Number.isInteger(perWeek) || perWeek < 1 || perWeek > 14) fail("Say which days, or how many sessions a week");
  if (!Array.isArray(raw.stages) || !raw.stages.length) fail("The program has no stages");
  let lastWeek = 0;
  const stages = raw.stages.map((s, i) => {
    const fromWeek = i === 0 ? 1 : Math.max(1, Math.floor(Number(s.fromWeek ?? lastWeek)));
    if (!(fromWeek >= lastWeek)) fail(`Stage ${i + 1} starts before the one before it`);
    lastWeek = fromWeek;
    if (!Array.isArray(s.steps) || !s.steps.length) fail(`Stage ${i + 1} has no steps`);
    const steps = s.steps.map((st, j) => {
      const where = `stage ${i + 1}, step ${j + 1}`;
      const stepName = String(st.name ?? "").trim() || fail(`No name at ${where}`);
      if (st.type === "timer") {
        const minutes = Number(st.minutes);
        if (!(minutes > 0 && minutes <= 180)) fail(`Minutes must be more than 0 at ${where}`);
        return { type: "timer", name: stepName, minutes, ...(st.note ? { note: String(st.note) } : {}) };
      }
      if (st.type !== undefined && st.type !== "exercise") fail(`Unknown step type at ${where}`);
      const sets = Number(st.sets), reps = Number(st.reps);
      if (!Number.isInteger(sets) || sets < 1 || sets > 50) fail(`Sets must be a whole number at ${where}`);
      if (!Number.isInteger(reps) || reps < 1 || reps > 1000) fail(`Reps must be a whole number at ${where}`);
      const out = { type: "exercise", name: stepName, sets, reps };
      if (st.tempo != null) {
        const tempo = Number(st.tempo);
        if (!(tempo >= 0.5 && tempo <= 10)) fail(`Tempo must be 0.5 to 10 seconds per rep at ${where}`);
        out.tempo = tempo;
      }
      if (st.rest != null) {
        const rest = Number(st.rest);
        if (!(rest > 0 && rest <= 3600)) fail(`Rest must be in seconds at ${where}`);
        out.rest = rest;
      }
      if (st.sides) out.sides = true;
      if (st.weight) out.weight = true;
      if (st.note) out.note = String(st.note);
      return out;
    });
    return {
      name: String(s.name ?? "").trim() || `Stage ${i + 1}`, fromWeek, steps,
      ...(s.note ? { note: String(s.note) } : {}), ...(s.loadProgression ? { loadProgression: true } : {}),
    };
  });
  const clean = { ...CLEAN_DEFAULTS };
  for (const k of Object.keys(CLEAN_DEFAULTS)) {
    const v = raw.clean?.[k];
    if (v === undefined) continue;
    clean[k] = typeof CLEAN_DEFAULTS[k] === "boolean" ? !!v : Number(v);
  }
  if (!(clean.sessionsPct >= 0 && clean.sessionsPct <= 100)) fail("Sessions share must be 0 to 100 %");
  if (!(clean.volumePct >= 0 && clean.volumePct <= 100)) fail("Volume share must be 0 to 100 %");
  if (!(clean.maxPain >= 0 && clean.maxPain <= 10)) fail("Highest pain must be 0 to 10");
  if (!Number.isInteger(clean.weeksToAdvance) || clean.weeksToAdvance < 1 || clean.weeksToAdvance > 52) fail("Clean weeks must be 1 to 52");
  const ci = raw.checkins ?? {};
  return {
    format: FORMAT, version: 1,
    id: String(raw.id ?? "").trim() || slug(name),
    name, about: String(raw.about ?? ""), days, perWeek, unit: String(raw.unit ?? "kg"),
    rules: (raw.rules ?? []).map(String).filter((r) => r.trim()),
    checkins: {
      pain: !!ci.pain, painQuestion: String(ci.painQuestion ?? ""),
      morning: !!ci.morning, morningQuestion: String(ci.morningQuestion ?? ""),
    },
    clean, stages,
  };
}

function slug(s) {
  return s.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "program";
}

// ------------------------------------------------------------------ calendar

/** Local calendar day of a Date, "YYYY-MM-DD". */
export function dayKey(date = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

const toUTC = (key) => { const [y, m, d] = key.split("-").map(Number); return Date.UTC(y, m - 1, d); };
const fromUTC = (ms) => new Date(ms).toISOString().slice(0, 10);

export function addDays(key, n) { return fromUTC(toUTC(key) + n * 86400000); }
export function daysBetween(a, b) { return Math.round((toUTC(b) - toUTC(a)) / 86400000); }
/** 1 = Monday ... 7 = Sunday. */
export function weekday(key) { return ((new Date(toUTC(key)).getUTCDay() + 6) % 7) + 1; }
/** The Monday of the week holding `key`. */
export function weekOf(key) { return addDays(key, 1 - weekday(key)); }

/** Week number in the program, 1 for the week it started. */
export function programWeek(progress, key) {
  return Math.floor(daysBetween(weekOf(progress.startDay), weekOf(key)) / 7) + 1;
}

/** A fresh place in a program, starting today. */
export function startProgress(program, today) {
  return { programId: program.id, startDay: today, stage: 0, since: today, weights: {}, snoozed: null };
}

/** Sessions planned in the week starting on Monday `week` (the first week only counts from the start day). */
export function plannedInWeek(program, progress, week) {
  const first = week < progress.startDay ? progress.startDay : week;
  const end = addDays(week, 6);
  if (first > end) return 0;
  if (program.days.length) {
    let n = 0;
    for (let d = first; d <= end; d = addDays(d, 1)) if (program.days.includes(weekday(d))) n += 1;
    return n;
  }
  return Math.min(program.perWeek, daysBetween(first, end) + 1);
}

/** What today holds: the stage, its steps and whether a session is planned. */
export function todayPlan(program, progress, today, sessionsThisWeek = 0) {
  const stage = program.stages[Math.min(progress.stage, program.stages.length - 1)];
  const planned = program.days.length
    ? program.days.includes(weekday(today))
    : sessionsThisWeek < plannedInWeek(program, progress, weekOf(today));
  return { stage, stageIndex: progress.stage, week: programWeek(progress, today), planned, steps: stage.steps };
}

/** Planned reps in one session of a stage (both sides count). */
export function plannedReps(steps) {
  return steps.reduce((a, s) => a + (s.type === "exercise" ? s.sets * s.reps * (s.sides ? 2 : 1) : 0), 0);
}
