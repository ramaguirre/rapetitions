// The session log, kept on the phone (IndexedDB). Nothing here leaves the device; a backup file is
// written only when the user presses Export.
import { run } from "./db.js";

/** Adds or replaces a session record (see session.js). */
export const putSession = (rec) => run("sessions", "readwrite", (s) => s.put(rec));
/** All sessions, oldest first. */
export const listSessions = async () =>
  ((await run("sessions", "readonly", (s) => s.getAll())) || []).sort((a, b) => (a.start < b.start ? -1 : 1));
export const deleteSession = (id) => run("sessions", "readwrite", (s) => s.delete(id));
