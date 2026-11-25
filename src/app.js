// RApetitions page: camera, pose tracking, screen kept on, voice count. The method is in counter.js;
// programs, sessions and adherence in program.js, session.js and progress.js.
import { RepCounter } from "./counter.js";
import { PoseFeatures, motionFeatures, boxDownsample, SKELETON } from "./features.js";
import { POSE_OPTIONS, MOTION_OPTIONS } from "./modes.js";
import { RestTimer, clock } from "./rest.js";
import { RepPicker, clipFrames, clipSize, CLIP } from "./clip.js";
import { addClip, listClips, deleteClip } from "./clipstore.js";
import { T, lang } from "./text.js";
import { TEMPLATES, normalizeProgram, dayKey, weekOf, todayPlan, startProgress, addDays } from "./program.js";
import { GuidedSession, freeRecord, avgRepSeconds, tempoAdvice, sessionVolume, newId } from "./session.js";
import { weekSummary, overview, suggestion, accept, snooze, pendingMorning, programSessions } from "./progress.js";
import { putSession, listSessions, deleteSession } from "./logstore.js";
import { makeBackup, readBackup, newSessions, programFile } from "./backup.js";

const $ = (id) => document.getElementById(id);
const els = {
  stage: $("stage"), video: $("video"), overlay: $("overlay"), trace: $("trace"), count: $("count"),
  status: $("status"), sets: $("sets"), intro: $("intro"), start: $("start"), loadmsg: $("loadmsg"),
  controls: $("controls"), mode: $("mode"), flip: $("flip"), voice: $("voice"), endset: $("endset"),
  reset: $("reset"), stop: $("stop"), awake: $("awake"), perf: $("perf"), rest: $("rest"),
  clipsBtn: $("clipsbtn"), clipsIntro: $("clipsintro"), clips: $("clips"), clipsClose: $("clipsclose"),
  clipsOn: $("clipson"), clipsInfo: $("clipsinfo"), clipList: $("cliplist"),
  plan: $("plan"), timer: $("timer"), today: $("today"), todayProg: $("todayprog"), todayWhat: $("todaywhat"),
  weekLine: $("weekline"), suggest: $("suggest"), suggestText: $("suggesttext"), sugYes: $("sugyes"), sugNo: $("sugno"),
  todaySteps: $("todaysteps"), startPlan: $("startplan"), programBtn: $("programbtn"), historyBtn: $("historybtn"),
  next: $("next"), program: $("program"), programBody: $("programbody"), history: $("history"),
  historyBody: $("historybody"), summary: $("summary"), summaryBody: $("summarybody"), ask: $("ask"),
  askQ: $("askq"), askOpts: $("askopts"), fileIn: $("filein"),
};
for (const el of document.querySelectorAll("[data-i18n]")) {
  const v = T[el.dataset.i18n];
  if (typeof v === "string") el.textContent = v;
}

// Motion is the default (director, 2026-11-07: it works best on the phone). The key changed with
// that decision, so phones that saved "body" under the old key start in Motion once.
const SETTINGS_KEY = "rapetitions.settings.v2";
// The program being followed with the user's place in it, and the session in progress (a draft).
const PROGRAM_KEY = "rapetitions.program.v1", DRAFT_KEY = "rapetitions.draft.v1";
// Clips are off until the user turns them on (director, 2026-11-10: kept on the phone, shareable).
const settings = load(SETTINGS_KEY, { mode: "motion", voice: true, facing: "user", clips: false });
const app = {
  running: false, stream: null, landmarker: null, trackerFailed: false,
  counter: null, pose: new PoseFeatures(), lastPose: null, lastVideoTime: -1, frames: 0,
  wakeLock: null, seenPerson: false, t0: performance.now(), nextAt: 0, busyMs: 0, rest: new RestTimer(),
  picker: new RepPicker(), clipBuf: [], clipKept: null, lastCapT: -Infinity, clipsSaved: 0,
  // Session log and program (see the "sessions" section below).
  prog: loadProgram(), sessions: [], guided: null, sessionId: null, sessionStart: null, freeSets: [],
  repTimes: [], lastRest: null, tempoWarned: false, timerEnd: null, restSaid: false, finishing: false, skipRecord: false,
};
window.__rap = app; // for the browser tests

const small = document.createElement("canvas");
small.width = 64; // drawn at 64 x 48, then each 4 x 4 block averaged to the 16 x 12 grid
small.height = 48;
const smallCtx = small.getContext("2d", { willReadFrequently: true });
smallCtx.imageSmoothingQuality = "high";

newCounter();
renderButtons();

els.start.addEventListener("click", () => { app.guided = null; start(); });
els.stop.addEventListener("click", stop);
els.flip.addEventListener("click", async () => {
  settings.facing = settings.facing === "user" ? "environment" : "user";
  save();
  if (app.running) await openCamera();
});
els.mode.addEventListener("click", async () => {
  settings.mode = settings.mode === "body" ? "motion" : "body";
  save();
  newCounter();
  renderButtons();
  if (settings.mode === "body") await ensureTracker();
});
els.voice.addEventListener("click", () => {
  settings.voice = !settings.voice;
  save();
  renderButtons();
  if (settings.voice) say(String(app.counter.current || ""));
});
els.endset.addEventListener("click", () => handle(app.counter.endSet()));
els.reset.addEventListener("click", () => {
  app.counter.resetAll();
  app.freeSets = [];
  saveDraft();
  app.picker.reset();
  app.clipKept = null;
  app.rest.reset();
  renderRest();
  renderCount(false);
  renderSets();
});

// The screen lock is dropped when the page is hidden, and some phones drop it on their own: ask again.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && app.running) keepAwake();
});
els.stage.addEventListener("click", () => { if (app.running) keepAwake(); });
setInterval(() => { if (app.running && document.visibilityState === "visible") keepAwake(); }, 15000);

// ------------------------------------------------------------------ start / stop

async function start() {
  els.start.disabled = true;
  try {
    // Ask for the screen lock and voice inside the click: browsers allow them only after a gesture.
    keepAwake();
    if (settings.voice) say(" ");
    els.loadmsg.textContent = T.camera;
    await openCamera();
    if (settings.mode === "body") {
      els.loadmsg.textContent = T.loading;
      await ensureTracker();
    }
    els.intro.hidden = true;
    els.controls.hidden = false;
    els.awake.hidden = false;
    if (!app.sessionStart) { app.sessionStart = new Date().toISOString(); app.sessionId = newId(app.sessionStart); }
    renderControls();
    app.running = true;
    enterStep();
    renderPlan();
    loop();
  } catch (err) {
    console.warn(err);
    els.loadmsg.textContent = T.noCamera;
  } finally {
    els.start.disabled = false;
  }
}

// Stop: in a guided session, finish it (asking first if steps are left); otherwise log the free
// session and close the camera.
async function stop() {
  if (app.guided) {
    if (!app.guided.finished && !(await ask(T.finishAsk, [{ label: T.yes, value: true, cls: "ok" }, { label: T.no, value: false }]))) return;
    return finishSession();
  }
  if (app.counter.state === "counting") handle(app.counter.endSet());
  stopCamera();
  if (app.freeSets.length) {
    const rec = freeRecord({ id: app.sessionId, start: app.sessionStart, end: new Date().toISOString(),
      day: dayKey(new Date(app.sessionStart)), sets: app.freeSets, rests: app.rest.rests });
    await logSession(rec);
  }
  endSession();
}

function stopCamera() {
  app.running = false;
  app.clipBuf = []; // free the clip frames; a set in progress keeps its chosen rep
  if (app.stream) for (const tr of app.stream.getTracks()) tr.stop();
  app.stream = null;
  if (app.wakeLock) app.wakeLock.release().catch(() => {});
  app.wakeLock = null;
  els.intro.hidden = false;
  els.controls.hidden = true;
  els.awake.hidden = true;
  els.loadmsg.textContent = "";
}

async function openCamera() {
  if (app.stream) for (const tr of app.stream.getTracks()) tr.stop();
  app.stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: settings.facing, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, max: 30 } },
  });
  els.video.srcObject = app.stream;
  await els.video.play();
  const facing = app.stream.getVideoTracks()[0]?.getSettings?.().facingMode ?? settings.facing;
  els.stage.classList.toggle("mirror", facing !== "environment");
}

async function ensureTracker() {
  if (app.landmarker || app.trackerFailed) return;
  try {
    const { FilesetResolver, PoseLandmarker } = await import("../vendor/mediapipe/vision_bundle.mjs");
    const files = await FilesetResolver.forVisionTasks(new URL("../vendor/mediapipe/wasm", import.meta.url).href);
    const options = (delegate) => ({
      baseOptions: { modelAssetPath: new URL("../models/pose_landmarker_lite.task", import.meta.url).href, delegate },
      runningMode: "VIDEO",
      numPoses: 1,
    });
    // CPU by default: the GPU path froze a phone's whole system UI (graphics-driver hang).
    // `?gpu` in the address tries the GPU first, for phones where it is known to be fine.
    const wantGpu = new URLSearchParams(location.search).has("gpu");
    if (wantGpu) {
      try {
        app.landmarker = await PoseLandmarker.createFromOptions(files, options("GPU"));
      } catch (gpuErr) {
        console.info("GPU tracker unavailable, using CPU", gpuErr);
      }
    }
    if (!app.landmarker) app.landmarker = await PoseLandmarker.createFromOptions(files, options("CPU"));
  } catch (err) {
    console.warn("Body tracker failed", err);
    app.trackerFailed = true;
    settings.mode = "motion";
    newCounter();
    renderButtons();
    els.status.textContent = T.noTracker;
  }
}

// ------------------------------------------------------------------ screen on

async function keepAwake() {
  try {
    if (!("wakeLock" in navigator)) throw new Error("no Wake Lock API");
    if (app.wakeLock && !app.wakeLock.released) return;
    app.wakeLock = await navigator.wakeLock.request("screen");
    app.wakeLock.addEventListener("release", renderAwake);
  } catch (err) {
    if (!app.wakeLockWarned) console.info("Wake lock refused", err);
    app.wakeLockWarned = true;
    app.wakeLock = null;
  }
  renderAwake();
}

function renderAwake() {
  const on = !!app.wakeLock && !app.wakeLock.released;
  els.awake.textContent = on ? `☀ ${T.awake}` : `☾ ${T.asleep}`;
  els.awake.classList.toggle("off", !on);
}

// ------------------------------------------------------------------ frame loop

// Frames are skipped so that processing never takes more than about half of the time: a phone
// that is busy every millisecond stops answering taps (and Android then reports "not responding").
const MAX_FPS = 15;
function loop() {
  if (!app.running) return;
  const v = els.video;
  const now = performance.now();
  if (v.readyState >= 2 && v.currentTime !== app.lastVideoTime && now >= app.nextAt) {
    app.lastVideoTime = v.currentTime;
    processFrame((now - app.t0) / 1000);
    const took = performance.now() - now;
    app.busyMs = app.busyMs ? 0.9 * app.busyMs + 0.1 * took : took;
    app.nextAt = now + Math.max(1000 / MAX_FPS, 2 * app.busyMs);
    app.fpsFrames = (app.fpsFrames || 0) + 1;
    if (now - (app.fpsT || 0) > 1000) {
      app.fps = (app.fpsFrames * 1000) / (now - (app.fpsT || now - 1000));
      app.fpsFrames = 0;
      app.fpsT = now;
      els.perf.textContent = `${app.fps.toFixed(0)} fps · ${app.busyMs.toFixed(0)} ms`;
    }
  }
  if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(loop);
  else requestAnimationFrame(loop);
}

function processFrame(t) {
  const v = els.video;
  let features = null;
  app.lastPose = null;
  if (settings.mode === "body" && app.landmarker) {
    const res = app.landmarker.detectForVideo(v, performance.now());
    const lm = res.landmarks?.[0];
    if (lm) {
      app.lastPose = lm;
      features = app.pose.compute(lm, v.videoWidth / v.videoHeight);
    }
    app.seenPerson = !!lm;
  } else {
    smallCtx.drawImage(v, 0, 0, small.width, small.height);
    const grid = boxDownsample(smallCtx.getImageData(0, 0, small.width, small.height).data, small.width, small.height, 4);
    features = motionFeatures(grid, 16, 12);
    app.seenPerson = true;
  }
  app.frames += 1;
  if (app.guided?.step?.type === "timer") { drawOverlay(); renderStatus(); return; } // walking is not reps
  if (settings.clips) captureClipFrame(t);
  handle(app.counter.push(t, features));
  drawOverlay();
  drawTrace();
  renderStatus();
}

function handle(events) {
  for (const e of events) {
    if (e.type === "lock") {
      for (const rt of e.repTimes ?? []) clipRep(rt);
      app.repTimes = [...(e.repTimes ?? [])];
      app.tempoWarned = false;
      app.lastRest = app.rest.stop(e.t, e.reps, e.period);
      renderRest();
      renderCount(true);
      renderSets();
      say(withTempo(String(e.reps), e.period));
    }
    if (e.type === "rep") {
      clipRep(e.t);
      app.repTimes.push(e.t);
      renderCount(true);
      say(withTempo(String(e.reps), app.counter.display().period));
    }
    if (e.type === "setEnd") {
      saveClip(e.reps);
      if (e.reps > 0) app.rest.start(e.lastRepT ?? now());
      app.restSaid = false;
      const sec = avgRepSeconds(app.repTimes);
      app.repTimes = [];
      if (app.skipRecord) app.skipRecord = false;
      else if (e.reps > 0 && app.guided) afterAdvance(app.guided.recordSet(e.reps, round1(sec), round0(app.lastRest)));
      else if (e.reps > 0) { app.freeSets.push({ reps: e.reps, sec: round1(sec) }); saveDraft(); }
      app.lastRest = null;
      renderRest();
      renderCount(false);
      renderSets();
    }
  }
}

// ------------------------------------------------------------------ drawing

function renderCount(bump) {
  const c = app.counter;
  els.count.textContent = String(c.state === "counting" ? c.current : c.sets.length ? c.sets.at(-1) : 0);
  els.count.classList.toggle("searching", c.state !== "counting");
  if (bump) {
    els.count.classList.add("bump");
    setTimeout(() => els.count.classList.remove("bump"), 250);
  }
}

function renderSets() {
  const st = app.guided?.step;
  if (st) {
    els.sets.textContent = st.type === "exercise" && st.done.length ? T.stepDone(st.done.map((d) => d.reps).join(", ")) : "";
    return;
  }
  // "12, rest 2:05, 10": each finished rest sits between the sets it separates.
  const s = app.counter.sets, rests = app.rest.rests;
  const parts = [];
  s.forEach((n, i) => {
    if (i > 0 && rests[i - 1] !== undefined) parts.push(T.restBetween(clock(rests[i - 1])));
    parts.push(String(n));
  });
  els.sets.textContent = s.length ? T.sets(parts.join(", "), app.counter.total) : "";
}

function renderRest() {
  els.rest.hidden = !app.rest.resting || app.guided?.step?.type === "timer";
  const target = app.guided?.step?.rest;
  if (app.rest.resting) {
    const c = clock(app.rest.elapsed(now()));
    els.rest.textContent = target ? T.restTarget(c, clock(target)) : T.rest(c);
  }
}

// The rest clock runs on its own timer: frames may be skipped, minutes must not be.
setInterval(() => {
  if (app.running && app.timerEnd !== null) {
    const left = app.timerEnd - now();
    els.timer.textContent = clock(Math.ceil(Math.max(0, left)));
    if (left <= 0) { say(T.sayTime); afterAdvance(app.guided.skip()); }
  }
  if (!app.rest.resting) return;
  renderRest();
  const m = app.rest.tick(now());
  const target = app.guided?.step?.rest;
  if (target && !app.restSaid && app.rest.elapsed(now()) >= target && app.running) { app.restSaid = true; say(T.sayRestDone); }
  else if (m && app.running) say(T.minutes(m));
}, 250);

function now() {
  return (performance.now() - app.t0) / 1000; // the counter's clock
}

let lastStatus = "";
function renderStatus() {
  const d = app.counter.display();
  const st = app.guided?.step;
  let text;
  if (st?.type === "timer") text = T.timerStatus;
  else if (d.state === "counting" && tempoAdvice(d.period, st?.tempo)) text = T.slowerStatus(d.period.toFixed(1), st.tempo);
  else if (d.state === "counting") text = T.counting(d.period.toFixed(1));
  else if (!app.seenPerson) text = T.noPerson;
  else if (d.period) text = T.almost(d.period.toFixed(1));
  else if (app.counter.sets.length) text = T.setDone(app.counter.sets.at(-1));
  else text = T.looking;
  if (text !== lastStatus) els.status.textContent = lastStatus = text;
}

function drawOverlay() {
  const cv = els.overlay, v = els.video;
  const w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  const ctx = cv.getContext("2d");
  ctx.clearRect(0, 0, w, h);
  const lm = app.lastPose;
  if (!lm || !v.videoWidth) return;
  // Same mapping as `object-fit: cover` on the video.
  const s = Math.max(w / v.videoWidth, h / v.videoHeight);
  const ox = (w - v.videoWidth * s) / 2, oy = (h - v.videoHeight * s) / 2;
  const X = (p) => ox + p.x * v.videoWidth * s, Y = (p) => oy + p.y * v.videoHeight * s;
  const counting = app.counter.state === "counting";
  ctx.lineWidth = 4;
  ctx.strokeStyle = counting ? "rgba(56, 211, 159, 0.9)" : "rgba(255, 255, 255, 0.75)";
  ctx.beginPath();
  for (const [a, b] of SKELETON) {
    if ((lm[a].visibility ?? 1) < 0.3 || (lm[b].visibility ?? 1) < 0.3) continue;
    ctx.moveTo(X(lm[a]), Y(lm[a]));
    ctx.lineTo(X(lm[b]), Y(lm[b]));
  }
  ctx.stroke();
}

function drawTrace() {
  const cv = els.trace;
  const w = cv.clientWidth * devicePixelRatio, h = cv.clientHeight * devicePixelRatio;
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  const ctx = cv.getContext("2d");
  ctx.clearRect(0, 0, w, h);
  const d = app.counter.display();
  const pts = d.points;
  if (pts.length < 2) return;
  const tEnd = pts.at(-1).t, span = 8;
  const vis = pts.filter((q) => q.t >= tEnd - span);
  let lo = Infinity, hi = -Infinity;
  for (const q of vis) { lo = Math.min(lo, q.p); hi = Math.max(hi, q.p); }
  if (d.mid !== null) { lo = Math.min(lo, d.mid - d.h); hi = Math.max(hi, d.mid + d.h); }
  if (!(hi > lo)) return;
  const pad = 6 * devicePixelRatio;
  const X = (t) => w - ((tEnd - t) / span) * w;
  const Y = (p) => h - pad - ((p - lo) / (hi - lo)) * (h - 2 * pad);
  if (d.mid !== null) {
    ctx.fillStyle = "rgba(56, 211, 159, 0.15)";
    ctx.fillRect(0, Y(d.mid + d.h), w, Y(d.mid - d.h) - Y(d.mid + d.h));
  }
  ctx.lineWidth = 2 * devicePixelRatio;
  ctx.strokeStyle = d.state === "counting" ? "#38d39f" : "#a7adb8";
  ctx.beginPath();
  vis.forEach((q, i) => (i ? ctx.lineTo(X(q.t), Y(q.p)) : ctx.moveTo(X(q.t), Y(q.p))));
  ctx.stroke();
}

function renderControls() {
  const g = !!app.guided;
  els.controls.classList.toggle("guided", g);
  els.next.hidden = !g;
  els.reset.hidden = g;
  els.stop.textContent = g ? T.finish : T.stop;
}

function renderButtons() {
  els.mode.textContent = settings.mode === "body" ? T.body : T.motion;
  els.voice.textContent = settings.voice ? T.voiceOn : T.voiceOff;
  els.clipsBtn.textContent = settings.clips ? T.clipsOn : T.clipsOff;
  els.clipsBtn.classList.toggle("on", settings.clips);
  els.clipsOn.checked = settings.clips;
}

// ------------------------------------------------------------------ rep clips
// Optional (off by default). The last few seconds are kept as small frames in memory; when a rep
// is counted, the picker decides whether it is the set's most typical rep so far, and if so its
// frames are kept. When the set ends, those frames become a looping GIF (encoded in a worker) that
// is stored on the phone. Nothing is sent anywhere.

const cap = document.createElement("canvas");
const capCtx = cap.getContext("2d", { willReadFrequently: true });

function captureClipFrame(t) {
  const v = els.video;
  if (!v.videoWidth || t - app.lastCapT < 1 / CLIP.fps - 0.01) return;
  app.lastCapT = t;
  const { w, h } = clipSize(v.videoWidth, v.videoHeight);
  if (cap.width !== w || cap.height !== h) { cap.width = w; cap.height = h; app.clipBuf = []; }
  // Same picture as the screen: mirrored for the front camera, with the skeleton in Body mode.
  const mirror = els.stage.classList.contains("mirror");
  capCtx.setTransform(mirror ? -1 : 1, 0, 0, 1, mirror ? w : 0, 0);
  capCtx.drawImage(v, 0, 0, w, h);
  const lm = app.lastPose;
  if (lm) {
    capCtx.lineWidth = 2;
    capCtx.strokeStyle = "rgb(56, 211, 159)";
    capCtx.beginPath();
    for (const [a, b] of SKELETON) {
      if ((lm[a].visibility ?? 1) < 0.3 || (lm[b].visibility ?? 1) < 0.3) continue;
      capCtx.moveTo(lm[a].x * w, lm[a].y * h);
      capCtx.lineTo(lm[b].x * w, lm[b].y * h);
    }
    capCtx.stroke();
  }
  capCtx.setTransform(1, 0, 0, 1, 0, 0);
  app.clipBuf.push({ t, w, h, data: capCtx.getImageData(0, 0, w, h).data });
  while (app.clipBuf.length && app.clipBuf[0].t < t - CLIP.keepSec) app.clipBuf.shift();
}

function clipRep(t) {
  if (!settings.clips) return;
  const r = app.picker.rep(t, app.clipBuf.length ? app.clipBuf[0].t : Infinity);
  if (!r) return;
  const frames = clipFrames(app.clipBuf, r.start, r.end);
  if (frames.length >= 2) app.clipKept = { frames, seconds: r.end - r.start };
}

let worker = null, jobs = 0;
const pending = new Map();
function encode(frames, w, h) {
  const id = ++jobs;
  const msg = { id, w, h, frames: frames.map((f) => ({ data: f.data, delay: f.delay })) };
  return new Promise((resolve, reject) => {
    try {
      if (!worker) {
        worker = new Worker(new URL("./gifworker.js", import.meta.url), { type: "module" });
        worker.onmessage = (e) => {
          const job = pending.get(e.data.id);
          pending.delete(e.data.id);
          if (e.data.error) job?.reject(new Error(e.data.error));
          else job?.resolve(e.data.gif);
        };
      }
      pending.set(id, { resolve, reject });
      worker.postMessage(msg);
    } catch (err) {
      // No module workers: encode here (the set is over, so a short pause does no harm).
      import("./gif.js").then((m) => resolve(m.encodeGif(msg.frames, w, h)), reject);
    }
  });
}

async function saveClip(reps) {
  const kept = app.clipKept;
  app.picker.reset();
  app.clipKept = null;
  if (!settings.clips || !kept || reps < 2) return;
  const { w, h } = kept.frames[0];
  try {
    const gif = await encode(kept.frames, w, h);
    await addClip({
      date: new Date().toISOString(), reps, seconds: kept.seconds, mode: settings.mode, w, h,
      gif: new Blob([gif], { type: "image/gif" }),
    });
    app.clipsSaved += 1;
    if (!els.clips.hidden) renderClips();
  } catch (err) {
    console.warn("Clip not saved", err);
  }
}

// The Clips panel: list, share, delete, and the on/off switch.
const urls = [];
async function renderClips() {
  let list = [];
  try { list = await listClips(); } catch (err) { console.warn("Clips unavailable", err); }
  for (const u of urls.splice(0)) URL.revokeObjectURL(u);
  const bytes = list.reduce((a, c) => a + (c.gif?.size || 0), 0);
  els.clipsInfo.textContent = T.clipsInfo(list.length, bytes < 1e6 ? `${Math.ceil(bytes / 1e3)} kB` : `${(bytes / 1e6).toFixed(1)} MB`);
  els.clipList.replaceChildren(...list.map((c) => {
    const li = document.createElement("li");
    const img = document.createElement("img");
    const url = URL.createObjectURL(c.gif);
    urls.push(url);
    img.src = url;
    img.alt = "";
    img.width = c.w;
    img.height = c.h;
    const info = document.createElement("div");
    const when = document.createElement("div");
    when.className = "when";
    when.textContent = new Date(c.date).toLocaleString(lang === "es" ? "es" : "en", { dateStyle: "medium", timeStyle: "short" });
    const what = document.createElement("div");
    what.textContent = T.clipLine(c.reps, c.seconds.toFixed(1));
    const share = document.createElement("button");
    share.textContent = T.share;
    share.addEventListener("click", () => shareClip(c));
    const del = document.createElement("button");
    del.textContent = T.del;
    del.addEventListener("click", async () => {
      if (!confirm(T.delAsk)) return;
      await deleteClip(c.id);
      renderClips();
    });
    const row = document.createElement("div");
    row.className = "row";
    row.append(share, del);
    info.append(when, what, row);
    li.append(img, info);
    return li;
  }));
}

async function shareClip(c) {
  const stamp = c.date.slice(0, 16).replace(/[-:]/g, "").replace("T", "-");
  return shareFile(new File([c.gif], `rapetitions-${stamp}-${c.reps}reps.gif`, { type: "image/gif" }));
}

/** Hands a file to another app (share sheet), or saves it as a download where sharing is not offered. */
async function shareFile(file) {
  try {
    if (navigator.canShare?.({ files: [file] })) return await navigator.share({ files: [file] });
  } catch (err) {
    if (err?.name === "AbortError") return; // the user closed the share sheet
    console.info("Share failed, downloading instead", err);
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

function openClips() {
  els.clips.hidden = false;
  renderClips();
}
els.clipsBtn.addEventListener("click", openClips);
els.clipsIntro.addEventListener("click", openClips);
els.clipsClose.addEventListener("click", () => { els.clips.hidden = true; });
els.clipsOn.addEventListener("change", () => {
  settings.clips = els.clipsOn.checked;
  save();
  if (!settings.clips) { app.clipBuf = []; app.clipKept = null; } // free the frames now
  app.picker.reset();
  renderButtons();
});

// ------------------------------------------------------------------ sessions and programs
// Every session is logged on the phone (IndexedDB). With a program, "Start today's session" walks
// its steps: each counted set fills the next set of the current exercise. A draft is kept after
// each set so a session cut short (app closed, phone restarted) is still logged, as unfinished.

function loadProgram() {
  try {
    const raw = JSON.parse(localStorage.getItem(PROGRAM_KEY) || "null");
    if (!raw?.program || !raw.progress) return null;
    return { program: normalizeProgram(raw.program), progress: raw.progress };
  } catch (err) {
    console.warn("Program not loaded", err);
    return null;
  }
}

function saveProgram() {
  try {
    if (app.prog) localStorage.setItem(PROGRAM_KEY, JSON.stringify(app.prog));
    else localStorage.removeItem(PROGRAM_KEY);
  } catch { /* private mode: kept for this visit only */ }
}

const round1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
const round0 = (x) => (x == null ? null : Math.round(x));
const fmtDay = (key, opts = { weekday: "short", day: "numeric", month: "short" }) =>
  new Date(`${key}T12:00:00`).toLocaleDateString(lang, opts);
const fmtTime = (iso) => new Date(iso).toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit" });
const dayName = (d) => new Date(2026, 10, 1 + d).toLocaleDateString(lang, { weekday: "short" }); // 2026-11-02 is a Monday

/** The rep number, plus "slower" once per set when reps are clearly faster than the target. */
function withTempo(text, period) {
  const target = app.guided?.step?.tempo;
  if (app.tempoWarned || !tempoAdvice(period, target)) return text;
  app.tempoWarned = true;
  return `${text}, ${T.slower}`;
}

function startPlan() {
  const P = app.prog;
  const today = dayKey();
  const plan = todayPlan(P.program, P.progress, today, thisWeek().length);
  app.guided = new GuidedSession({
    programId: P.program.id, programName: P.program.name, stage: plan.stageIndex, stageName: plan.stage.name,
    planned: plan.planned, unit: P.program.unit, steps: plan.steps, weights: P.progress.weights,
  }, new Date().toISOString());
  app.sessionStart = app.guided.start;
  app.sessionId = app.guided.id;
  newCounter();
  app.rest.reset();
  saveDraft();
  start();
}

/** A new step began: a timer step starts its clock. */
function enterStep() {
  const st = app.guided?.step;
  app.timerEnd = st?.type === "timer" ? now() + st.minutes * 60 : null;
  els.timer.hidden = app.timerEnd === null;
  els.count.hidden = app.timerEnd !== null;
  renderRest();
}

/** After a set was counted or skipped: say what comes next, or finish. */
function afterAdvance(r) {
  saveDraft();
  if (r.finished) {
    say(T.sayDone);
    finishSession();
    return;
  }
  const sl = app.guided.slot();
  if (r.stepChanged) {
    enterStep();
    newCounter();
    app.rest.reset();
    say(T.sayNext(sl.step.name) + (sl.side ? `, ${T.saySide(T[sl.side])}` : ""));
  } else if (sl.side) {
    setTimeout(() => say(T.saySide(T[sl.side])), 900); // after the last rep number
  }
  renderPlan();
  renderSets();
}

function renderPlan() {
  els.next.textContent = app.guided?.step?.type === "timer" ? T.skip : T.next;
  const sl = app.guided?.slot();
  els.plan.hidden = !sl;
  if (!sl) { els.timer.hidden = true; els.count.hidden = false; return; }
  const st = sl.step;
  const top = document.createElement("div");
  const sub = document.createElement("small");
  const bits = [];
  if (st.type === "timer") {
    top.textContent = st.name;
    if (sl.next) bits.push(T.nextUp(sl.next.name));
  } else {
    top.textContent = T.planLine(st.name, sl.set, sl.of, sl.target);
    if (sl.side) {
      const sp = document.createElement("span");
      sp.className = "side";
      sp.textContent = ` · ${T[sl.side]}`;
      top.append(sp);
    }
  }
  if (st.tempo) bits.push(T.planTempo(st.tempo));
  if (st.weight !== undefined) bits.push(st.weight == null ? `${T.weight}: ${T.bodyweight}` : `${st.weight} ${app.guided.plan.unit}`);
  if (st.type === "exercise" && sl.next) bits.push(T.nextUp(sl.next.name));
  sub.textContent = bits.join(" · ");
  els.plan.replaceChildren(top, ...(bits.length ? [sub] : []));
}

els.startPlan.addEventListener("click", startPlan);
els.next.addEventListener("click", () => {
  if (!app.guided) return;
  if (app.counter.state === "counting") { app.skipRecord = true; handle(app.counter.endSet()); }
  afterAdvance(app.guided.skip());
});

async function finishSession() {
  if (app.finishing || !app.guided) return;
  app.finishing = true;
  try {
    if (app.counter.state === "counting") handle(app.counter.endSet());
    stopCamera();
    const g = app.guided;
    const P = app.prog;
    let pain = null;
    if (P?.program.id === g.plan.programId && P.program.checkins.pain) {
      const opts = Array.from({ length: 11 }, (_, i) => ({ label: String(i), value: i }));
      opts.push({ label: T.skip, value: null, cls: "wide" });
      pain = await ask(P.program.checkins.painQuestion || T.painQ, opts, { scale: true });
    }
    const rec = g.record({ end: new Date().toISOString(), day: dayKey(new Date(g.start)), pain });
    await logSession(rec);
    endSession();
    showSummary(rec);
  } finally {
    app.finishing = false;
  }
}

/** Clears the session state once it is logged (or nothing was done). */
function endSession() {
  app.guided = null;
  app.sessionStart = null;
  app.sessionId = null;
  app.freeSets = [];
  app.timerEnd = null;
  clearDraft();
  newCounter();
  app.rest.reset();
  renderRest();
  renderPlan();
  renderControls();
  renderToday();
}

async function logSession(rec) {
  try {
    await putSession(rec);
  } catch (err) {
    console.warn("Session not saved", err);
  }
  app.sessions = app.sessions.filter((s) => s.id !== rec.id).concat(rec);
  clearDraft();
}

function saveDraft() {
  try {
    let d = null;
    if (app.guided) d = { ...app.guided.draft(), saved: new Date().toISOString() };
    else if (app.sessionStart && app.freeSets.length) {
      d = { kind: "free", id: app.sessionId, start: app.sessionStart, sets: app.freeSets, rests: app.rest.rests, saved: new Date().toISOString() };
    }
    if (d) localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    else localStorage.removeItem(DRAFT_KEY);
  } catch { /* private mode */ }
}

function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch { /* private mode */ }
}

/** A session that was cut short is logged as unfinished, with what was done. */
async function recoverDraft() {
  let d = null;
  try { d = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null"); } catch { /* unreadable: dropped */ }
  if (!d) return;
  let rec = null;
  try {
    const day = dayKey(new Date(d.start));
    if (d.kind === "guided") {
      const g = GuidedSession.restore(d);
      if (g.steps.some((s) => s.done?.length)) rec = g.record({ end: d.saved, day, unfinished: true });
    } else if (d.sets?.length) {
      rec = { ...freeRecord({ id: d.id, start: d.start, end: d.saved, day, sets: d.sets, rests: d.rests }), unfinished: true };
    }
  } catch (err) {
    console.warn("Unfinished session not recovered", err);
  }
  if (rec) await logSession(rec);
  clearDraft();
}

function thisWeek() {
  const P = app.prog;
  if (!P) return [];
  const w = weekOf(dayKey());
  return programSessions(P.program, P.progress, app.sessions).filter((s) => s.day >= w);
}

// ------------------------------------------------------------------ start screen: today

function renderToday() {
  const P = app.prog;
  els.intro.classList.toggle("planned", !!P);
  els.today.hidden = !P;
  els.start.textContent = P ? T.freeCount : T.start;
  if (!P) return;
  const { program, progress } = P;
  const today = dayKey();
  const week = thisWeek();
  const plan = todayPlan(program, progress, today, week.filter((s) => s.day < today).length);
  const doneToday = week.some((s) => s.day === today);
  els.todayProg.textContent = T.progLine(program.name, plan.week, plan.stage.name);
  els.todayWhat.textContent = doneToday ? T.todayDone : plan.planned ? T.todayPlanned : T.todayRest;
  const sum = weekSummary(program, progress, app.sessions, weekOf(today), today);
  els.weekLine.textContent = T.weekLine(sum.sessions, sum.planned, sum.volumePct);
  els.startPlan.textContent = plan.planned && !doneToday ? T.startPlan : T.startAnyway;
  els.startPlan.classList.toggle("quiet", !(plan.planned && !doneToday));
  els.todaySteps.replaceChildren(...plan.steps.map((st) => {
    const li = document.createElement("li");
    const what = document.createElement("div");
    what.className = "what";
    what.textContent = st.name;
    const small = document.createElement("small");
    small.textContent = st.type === "timer" ? T.mins(st.minutes)
      : [T.setsReps(st.sets, st.reps, st.sides), st.tempo ? T.planTempo(st.tempo) : ""].filter(Boolean).join(" · ");
    what.append(small);
    li.append(what);
    if (st.type === "exercise" && st.weight) {
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "number";
      input.inputMode = "decimal";
      input.min = "0";
      input.step = "0.5";
      input.placeholder = T.bodyweight;
      input.setAttribute("aria-label", `${T.weight}: ${st.name}`);
      const v = progress.weights?.[st.name];
      if (v != null) input.value = String(v);
      input.addEventListener("change", () => {
        const n = parseFloat(input.value);
        progress.weights = { ...progress.weights, [st.name]: n > 0 ? n : null };
        saveProgram();
      });
      label.append(input, program.unit);
      li.append(label);
    }
    return li;
  }));
  renderSuggestion();
}

function renderSuggestion() {
  const P = app.prog;
  const sug = P && suggestion(P.program, P.progress, app.sessions, dayKey());
  els.suggest.hidden = !sug;
  if (!sug) return;
  const c = P.program.clean;
  els.suggest.classList.toggle("warn", sug.type === "reduce");
  els.sugNo.hidden = sug.type === "reduce";
  if (sug.type === "advance") {
    els.suggestText.textContent = T.sugAdvance(c.weeksToAdvance, P.program.stages[sug.to].name);
    els.sugYes.textContent = T.moveUp;
  } else if (sug.type === "load") {
    els.suggestText.textContent = T.sugLoad(c.weeksToAdvance);
    els.sugYes.textContent = T.addWeight;
  } else {
    const last = app.sessions.find((s) => s.id === sug.session);
    els.suggestText.textContent = sug.why === "pain" ? T.sugPain(last?.pain, c.maxPain) : T.sugMorning;
    els.sugYes.textContent = T.ok;
  }
  els.sugNo.textContent = T.notNow;
  els.sugYes.onclick = () => { P.progress = accept(P.progress, sug, dayKey()); saveProgram(); renderToday(); };
  els.sugNo.onclick = () => { P.progress = snooze(P.progress, sug, dayKey()); saveProgram(); renderToday(); };
}

// ------------------------------------------------------------------ questions

/** Shows a question with buttons; resolves with the chosen value. */
function ask(question, options, { scale = false } = {}) {
  return new Promise((resolve) => {
    els.askQ.textContent = question;
    els.askOpts.classList.toggle("scale", scale);
    els.askOpts.replaceChildren(...options.map((o) => {
      const b = document.createElement("button");
      b.textContent = o.label;
      if (o.cls) b.className = o.cls;
      b.addEventListener("click", () => { els.ask.hidden = true; resolve(o.value); });
      return b;
    }));
    els.ask.hidden = false;
  });
}

async function askMorning() {
  const P = app.prog;
  const s = P && pendingMorning(P.program, P.progress, app.sessions, dayKey());
  if (!s || app.morningAsked) return;
  app.morningAsked = true; // "Later" waits for the next time the app is opened
  const q = `${P.program.checkins.morningQuestion || T.morningQ} ${T.morningOf(fmtDay(s.day, { weekday: "long", day: "numeric", month: "long" }))}`;
  const a = await ask(q, [{ label: T.mNo, value: "no", cls: "ok" }, { label: T.mBit, value: "bit" }, { label: T.mYes, value: "yes" }, { label: T.later, value: null }]);
  if (a === null) return;
  await logSession({ ...s, morning: a });
  renderToday();
}

// ------------------------------------------------------------------ session cards (history, summary)

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function sessionCard(rec, { del = false } = {}) {
  const card = el("div", "card");
  const head = el("div", "head");
  head.append(el("span", null, `${fmtDay(rec.day)} · ${fmtTime(rec.start)}`),
    el("span", "muted", rec.programId ? rec.stageName || rec.programName : T.freeSession));
  card.append(head);
  const ul = el("ul", "steps");
  for (const st of rec.steps) {
    if (st.type === "timer") {
      ul.append(el("li", null, `${st.name}: ${st.doneTimer ? T.mins(st.minutes) : T.skipped}`));
      continue;
    }
    const reps = st.done.map((d) => (d.side ? `${d.reps}${T[d.side][0].toUpperCase()}` : String(d.reps)));
    const secs = st.done.map((d) => d.sec).filter((x) => x != null);
    const bits = [reps.length ? reps.join(", ") : T.skipped];
    if (secs.length) {
      const avg = (secs.reduce((a, b) => a + b, 0) / secs.length).toFixed(1);
      bits.push(st.tempo ? T.repSecTarget(avg, st.tempo) : T.repSec(avg));
    }
    if (st.weight != null && st.weight !== true) bits.push(`${st.weight} ${rec.unit}`);
    ul.append(el("li", null, `${st.name ? `${st.name}: ` : ""}${bits.join(" · ")}`));
  }
  card.append(ul);
  const v = sessionVolume(rec);
  const foot = [v.planned ? T.volumeIs(v.done, v.planned) : T.totalReps(v.total)];
  if (rec.pain != null) foot.push(T.painIs(rec.pain));
  if (rec.morning) foot.push(T.morningIs[rec.morning]);
  if (rec.programId && !rec.planned) foot.push(T.offPlan);
  if (rec.unfinished) foot.push(T.unfinished);
  card.append(el("div", "muted", foot.join(" · ")));
  if (del) {
    const row = el("div", "row");
    const b = el("button", null, T.del);
    b.addEventListener("click", async () => {
      if (!confirm(T.delSessionAsk)) return;
      try { await deleteSession(rec.id); } catch (err) { console.warn(err); }
      app.sessions = app.sessions.filter((s) => s.id !== rec.id);
      renderHistory();
      renderToday();
    });
    row.append(b);
    card.append(row);
  }
  return card;
}

function stat(value, label) {
  const d = el("div");
  d.append(el("b", null, value), el("span", null, label));
  return d;
}

function showSummary(rec) {
  const body = [sessionCard(rec)];
  const P = app.prog;
  if (P && rec.programId === P.program.id) {
    const today = dayKey();
    const sum = weekSummary(P.program, P.progress, app.sessions, weekOf(today), today);
    body.push(el("p", null, T.weekLine(sum.sessions, sum.planned, sum.volumePct)));
  }
  els.summaryBody.replaceChildren(...body);
  els.summary.hidden = false;
}

// ------------------------------------------------------------------ history panel

function renderHistory() {
  const P = app.prog;
  const today = dayKey();
  const out = [];
  if (P) {
    const { program, progress } = P;
    const o = overview(program, progress, app.sessions, today);
    const w = o.weeks[0];
    out.push(el("h3", null, `${T.thisWeek} · ${program.name}`));
    const s1 = el("div", "stats");
    s1.append(stat(`${w.sessions}/${w.planned}`, T.lSessions), stat(`${w.volumePct}%`, T.lVolume));
    if (program.checkins.pain) s1.append(stat(w.maxPain ?? "–", T.lPain));
    if (program.checkins.morning) s1.append(stat(String(w.worse), T.lWorse));
    out.push(s1);
    out.push(el("h3", null, T.longTerm));
    const s2 = el("div", "stats");
    s2.append(stat(String(o.streak), T.lStreak));
    if (o.last4.weeks) s2.append(stat(`${o.last4.clean}/${o.last4.weeks}`, T.lLast4), stat(`${o.last4.sessionsPct}%`, T.l4Sess));
    s2.append(stat(`${Math.min(o.towardNext, program.clean.weeksToAdvance)}/${program.clean.weeksToAdvance}`, T.lToward(program.clean.weeksToAdvance)));
    out.push(s2);
    out.push(el("h3", null, T.weeks));
    const ul = el("ul", "weeks");
    for (const wk of o.weeks) {
      const li = el("li");
      li.append(el("span", null, T.weekRow(fmtDay(wk.week, { day: "numeric", month: "short" }))));
      const verdict = wk.planned === 0 ? T.restWeek : wk.clean === null ? T.inProgress : wk.clean ? `✓ ${T.clean}` : T.notClean;
      li.append(el("span", wk.clean ? "good" : wk.clean === false ? "bad" : "muted", verdict));
      const nums = [T.weekNums(wk.sessions, wk.planned, wk.volumePct)];
      if (wk.maxPain != null) nums.push(T.painMax(wk.maxPain));
      if (wk.reasons.length) nums.push(wk.reasons.map((r) => T.reasons[r]).join(", "));
      li.append(el("span", "muted", nums.join(" · ")));
      ul.append(li);
    }
    out.push(ul);
  }
  out.push(el("h3", null, T.sessions));
  const list = [...app.sessions].sort((a, b) => (a.start < b.start ? 1 : -1));
  if (!list.length) out.push(el("p", "small", T.noSessions));
  for (const s of list) out.push(sessionCard(s, { del: true }));
  out.push(el("h3", null, T.backup));
  out.push(el("p", "small", T.backupInfo));
  const row = el("div", "row");
  const ex = el("button", null, T.exportBackup);
  ex.addEventListener("click", exportBackup);
  const im = el("button", null, T.importBackup);
  im.addEventListener("click", () => pickFile(importBackup));
  row.append(ex, im);
  out.push(row);
  els.historyBody.replaceChildren(...out);
}

async function exportBackup() {
  const data = makeBackup({ program: app.prog?.program, progress: app.prog?.progress, sessions: app.sessions, exported: new Date().toISOString() });
  const name = `rapetitions-backup-${dayKey()}.json`;
  await shareFile(new File([JSON.stringify(data)], name, { type: "application/json" }));
}

async function importBackup(text) {
  const b = readBackup(JSON.parse(text));
  const add = newSessions(app.sessions, b.sessions);
  for (const s of add) await logSession(s);
  if (b.program && b.progress && app.prog?.program.id !== b.program.id && confirm(T.importProgramAsk(b.program.name))) {
    app.prog = { program: b.program, progress: b.progress };
    saveProgram();
  }
  alert(T.imported(add.length));
  renderHistory();
  renderToday();
}

/** Opens the file picker and hands the chosen file's text to `fn`. */
function pickFile(fn) {
  els.fileIn.value = "";
  els.fileIn.onchange = async () => {
    const f = els.fileIn.files?.[0];
    if (!f) return;
    try {
      await fn(await f.text());
    } catch (err) {
      alert(T.badFile(err.message));
    }
  };
  els.fileIn.click();
}

// ------------------------------------------------------------------ program panel

function renderProgram() {
  const P = app.prog;
  const out = [];
  if (P) {
    const { program, progress } = P;
    out.push(el("h3", null, program.name));
    if (program.about) out.push(el("p", null, program.about));
    out.push(el("p", "small", [
      program.days.length ? T.days(program.days.map(dayName).join(", ")) : T.perWeek(program.perWeek),
      T.since(fmtDay(progress.startDay, { day: "numeric", month: "long", year: "numeric" })),
    ].join(" · ")));
    out.push(el("h3", null, T.stages));
    program.stages.forEach((st, i) => {
      const card = el("div", "card");
      const head = el("div", "head");
      head.append(el("span", null, `${i + 1}. ${st.name}`), el("span", i === progress.stage ? "good" : "muted", i === progress.stage ? T.now : T.fromWeek(st.fromWeek)));
      card.append(head);
      if (st.note) card.append(el("div", "muted", st.note));
      const ul = el("ul", "steps");
      for (const s of st.steps) {
        ul.append(el("li", null, `${s.name}: ${s.type === "timer" ? T.mins(s.minutes)
          : [T.setsReps(s.sets, s.reps, s.sides), s.tempo ? T.planTempo(s.tempo) : ""].filter(Boolean).join(" · ")}`));
      }
      card.append(ul);
      if (i !== progress.stage) {
        const row = el("div", "row");
        const b = el("button", null, T.goStage);
        b.addEventListener("click", () => {
          if (!confirm(T.stageAsk(st.name))) return;
          P.progress = { ...progress, stage: i, since: dayKey(), snoozed: null };
          saveProgram();
          renderProgram();
          renderToday();
        });
        row.append(b);
        card.append(row);
      }
      out.push(card);
    });
    if (program.rules.length) {
      out.push(el("h3", null, T.rules));
      const ul = el("ul", "steps");
      for (const r of program.rules) ul.append(el("li", null, r));
      out.push(ul);
    }
    out.push(cleanForm(P));
    const row = el("div", "row");
    const ex = el("button", null, T.exportProgram);
    ex.addEventListener("click", () => shareFile(new File([programFile(program)], `${program.id}.json`, { type: "application/json" })));
    const stopB = el("button", null, T.stopProgram);
    stopB.addEventListener("click", () => {
      if (!confirm(T.stopAsk)) return;
      app.prog = null;
      saveProgram();
      renderProgram();
      renderToday();
    });
    row.append(ex, stopB);
    out.push(row);
  } else {
    out.push(el("p", null, T.programNone));
  }
  out.push(el("h3", null, T.templates));
  for (const t of TEMPLATES) {
    const p = normalizeProgram(t);
    if (P?.program.id === p.id) continue;
    const card = el("div", "card");
    card.append(el("div", "head", p.name));
    if (p.about) card.append(el("div", "muted", p.about));
    const row = el("div", "row");
    const b = el("button", null, T.startThis);
    b.addEventListener("click", () => follow(p));
    row.append(b);
    card.append(row);
    out.push(card);
  }
  const row = el("div", "row");
  const im = el("button", null, T.importProgram);
  im.addEventListener("click", () => pickFile(async (text) => follow(normalizeProgram(JSON.parse(text)))));
  row.append(im);
  out.push(row);
  els.programBody.replaceChildren(...out);
}

function follow(program) {
  if (app.prog && !confirm(T.switchAsk(program.name))) return;
  app.prog = { program, progress: startProgress(program, dayKey()) };
  saveProgram();
  renderProgram();
  renderToday();
}

function cleanForm(P) {
  const c = P.program.clean, ci = P.program.checkins;
  const wrap = el("div");
  wrap.append(el("h3", null, T.cleanTitle));
  const form = el("div", "form");
  const fields = [
    ["sessionsPct", T.cleanSessions, 0, 100], ["volumePct", T.cleanVolume, 0, 100],
    ...(ci.pain ? [["maxPain", T.cleanPain, 0, 10]] : []), ...(ci.morning ? [["noWorseMornings", T.cleanMorning]] : []),
    ["noExtraSessions", T.cleanExtra], ["weeksToAdvance", T.cleanWeeks, 1, 52],
  ];
  const inputs = {};
  for (const [k, label, min, max] of fields) {
    const l = el("label");
    const input = document.createElement("input");
    if (typeof c[k] === "boolean") { input.type = "checkbox"; input.checked = c[k]; } else {
      input.type = "number"; input.min = String(min); input.max = String(max); input.value = String(c[k]); input.inputMode = "numeric";
    }
    inputs[k] = input;
    l.append(el("span", null, label), input);
    form.append(l);
  }
  const row = el("div", "row");
  const b = el("button", null, T.save);
  const msg = el("span", "muted");
  b.addEventListener("click", () => {
    const clean = { ...c };
    for (const [k, input] of Object.entries(inputs)) clean[k] = input.type === "checkbox" ? input.checked : Number(input.value);
    try {
      P.program = normalizeProgram({ ...P.program, clean });
      saveProgram();
      msg.textContent = T.saved;
      renderToday();
    } catch (err) {
      msg.textContent = err.message;
    }
  });
  row.append(b, msg);
  wrap.append(form, row);
  return wrap;
}

// ------------------------------------------------------------------ panels

for (const panel of [els.program, els.history, els.summary]) {
  panel.querySelector(".close").addEventListener("click", () => { panel.hidden = true; });
}
els.programBtn.addEventListener("click", () => { renderProgram(); els.program.hidden = false; });
els.historyBtn.addEventListener("click", () => { renderHistory(); els.history.hidden = false; });

// On opening: log any session cut short, read the log, then ask the morning question if it is due.
app.ready = (async () => {
  try {
    await recoverDraft();
    const stored = await listSessions();
    const ids = new Set(stored.map((s) => s.id));
    app.sessions = stored.concat(app.sessions.filter((s) => !ids.has(s.id)));
  } catch (err) {
    console.warn("Session log unavailable", err);
  }
  renderToday();
  await askMorning();
})();
renderToday();
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && !app.running) { renderToday(); askMorning(); }
});

// ------------------------------------------------------------------ helpers

function newCounter() {
  app.counter = new RepCounter(settings.mode === "body" ? POSE_OPTIONS : MOTION_OPTIONS);
  app.picker.reset();
  app.clipKept = null;
  app.pose.reset();
  renderCount(false);
  renderSets();
}

function say(text) {
  if (!settings.voice || !("speechSynthesis" in window)) return;
  try {
    speechSynthesis.cancel(); // never queue up: the latest number is the only one that matters
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang === "es" ? "es-ES" : "en-US";
    u.rate = 1.15;
    speechSynthesis.speak(u);
  } catch (err) {
    console.info("Speech failed", err);
  }
}

function load(key, fallback) {
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(key) || "{}") };
  } catch {
    return { ...fallback };
  }
}

function save() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* private mode: settings last for this visit only */
  }
}

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch((err) => console.info("No offline cache", err));
}
