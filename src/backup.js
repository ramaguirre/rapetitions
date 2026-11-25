// Backup file of the session log (and the program being followed), written only when the user
// presses Export, and read back with Import. No browser APIs, so it is tested in Node.
// Clips are not in the backup: they are pictures, kept on the phone or shared one by one.
import { normalizeProgram } from "./program.js";

export const BACKUP = "rapetitions-backup";

export function makeBackup({ program, progress, sessions, exported }) {
  return { format: BACKUP, version: 1, exported, program: program ?? null, progress: progress ?? null, sessions };
}

/** Checks a backup file's contents. Throws an Error that says what is wrong. */
export function readBackup(obj) {
  if (!obj || obj.format !== BACKUP) throw new Error("Not a RApetitions backup");
  if (!Array.isArray(obj.sessions)) throw new Error("The backup has no sessions");
  const sessions = obj.sessions.filter((s) =>
    s && typeof s.id === "string" && typeof s.start === "string" && /^\d{4}-\d\d-\d\d$/.test(s.day) && Array.isArray(s.steps));
  const program = obj.program ? normalizeProgram(obj.program) : null;
  const progress = program && obj.progress && /^\d{4}-\d\d-\d\d$/.test(obj.progress.startDay) ? obj.progress : null;
  return { program, progress, sessions, skipped: obj.sessions.length - sessions.length };
}

/** The sessions of a backup not already in the log (same id = same session). */
export function newSessions(existing, incoming) {
  const have = new Set(existing.map((s) => s.id));
  return incoming.filter((s) => !have.has(s.id));
}

/** A program as a file to share: the program only, never the log. */
export function programFile(program) {
  return JSON.stringify(normalizeProgram(program), null, 2);
}
