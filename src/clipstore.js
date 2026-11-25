// Rep clips kept on the phone (IndexedDB). Nothing here leaves the device.
import { run } from "./db.js";

/** Saves {date, reps, seconds, mode, w, h, gif: Blob}; returns its id. */
export const addClip = (clip) => run("clips", "readwrite", (s) => s.add(clip));
/** All clips, newest first. */
export const listClips = async () => ((await run("clips", "readonly", (s) => s.getAll())) || []).reverse();
export const deleteClip = (id) => run("clips", "readwrite", (s) => s.delete(id));
