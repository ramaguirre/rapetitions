// Rep clips kept on the phone (IndexedDB). Nothing here leaves the device.
const DB = "rapetitions", STORE = "clips";
let dbp = null;

function db() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    dbp.catch(() => { dbp = null; });
  }
  return dbp;
}

async function run(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

/** Saves {date, reps, seconds, mode, w, h, gif: Blob}; returns its id. */
export const addClip = (clip) => run("readwrite", (s) => s.add(clip));
/** All clips, newest first. */
export const listClips = async () => ((await run("readonly", (s) => s.getAll())) || []).reverse();
export const deleteClip = (id) => run("readwrite", (s) => s.delete(id));
