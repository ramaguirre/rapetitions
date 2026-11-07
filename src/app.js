// RApetitions page: camera, pose tracking, screen kept on, voice count. The method is in counter.js.
import { RepCounter } from "./counter.js";
import { PoseFeatures, motionFeatures, boxDownsample, SKELETON } from "./features.js";
import { POSE_OPTIONS, MOTION_OPTIONS } from "./modes.js";

const TEXT = {
  en: {
    ready: "Ready", start: "Start", flip: "Flip", endset: "End set", reset: "Reset", stop: "Stop",
    intro1: "Prop the phone up so your body is in view, then start your set.",
    intro2: "After a few reps it finds the rhythm and counts by itself. The first reps are included.",
    loading: "Loading the body tracker…", camera: "Opening the camera…",
    noCamera: "No camera: allow camera access for this page and try again.",
    noTracker: "The body tracker did not load; using Motion mode.",
    body: "Mode: Body", motion: "Mode: Motion", voiceOn: "Voice: on", voiceOff: "Voice: off",
    looking: "Start moving: counting begins after a few reps",
    noPerson: "Step back until your body is in view",
    almost: (p) => `Rhythm found (${p} s per rep)…`,
    counting: (p) => `Counting · ${p} s per rep`,
    setDone: (n) => `Set done: ${n} reps · resting`,
    sets: (list, total) => `Sets: ${list} · total ${total}`,
    awake: "Screen stays on", asleep: "Screen may sleep",
  },
  es: {
    ready: "Listo", start: "Comenzar", flip: "Girar", endset: "Fin serie", reset: "Reiniciar", stop: "Detener",
    intro1: "Apoya el teléfono de modo que se vea tu cuerpo y empieza la serie.",
    intro2: "Tras algunas repeticiones encuentra el ritmo y cuenta solo. Las primeras se incluyen.",
    loading: "Cargando el detector de cuerpo…", camera: "Abriendo la cámara…",
    noCamera: "Sin cámara: permite el acceso a la cámara para esta página y vuelve a intentar.",
    noTracker: "El detector de cuerpo no cargó; se usa el modo Movimiento.",
    body: "Modo: Cuerpo", motion: "Modo: Movimiento", voiceOn: "Voz: sí", voiceOff: "Voz: no",
    looking: "Empieza a moverte: cuenta tras algunas repeticiones",
    noPerson: "Aléjate hasta que se vea tu cuerpo",
    almost: (p) => `Ritmo encontrado (${p} s por repetición)…`,
    counting: (p) => `Contando · ${p} s por repetición`,
    setDone: (n) => `Serie terminada: ${n} repeticiones · descanso`,
    sets: (list, total) => `Series: ${list} · total ${total}`,
    awake: "Pantalla siempre encendida", asleep: "La pantalla puede apagarse",
  },
};
const lang = (navigator.language || "en").toLowerCase().startsWith("es") ? "es" : "en";
const T = TEXT[lang];
document.documentElement.lang = lang;

const $ = (id) => document.getElementById(id);
const els = {
  stage: $("stage"), video: $("video"), overlay: $("overlay"), trace: $("trace"), count: $("count"),
  status: $("status"), sets: $("sets"), intro: $("intro"), start: $("start"), loadmsg: $("loadmsg"),
  controls: $("controls"), mode: $("mode"), flip: $("flip"), voice: $("voice"), endset: $("endset"),
  reset: $("reset"), stop: $("stop"), awake: $("awake"), perf: $("perf"),
};
for (const el of document.querySelectorAll("[data-i18n]")) {
  const v = T[el.dataset.i18n];
  if (typeof v === "string") el.textContent = v;
}

// Motion is the default (director, 2026-11-07: it works best on the phone). The key changed with
// that decision, so phones that saved "body" under the old key start in Motion once.
const SETTINGS_KEY = "rapetitions.settings.v2";
const settings = load(SETTINGS_KEY, { mode: "motion", voice: true, facing: "user" });
const app = {
  running: false, stream: null, landmarker: null, trackerFailed: false,
  counter: null, pose: new PoseFeatures(), lastPose: null, lastVideoTime: -1, frames: 0,
  wakeLock: null, seenPerson: false, t0: performance.now(), nextAt: 0, busyMs: 0,
};
window.__rap = app; // for the browser tests

const small = document.createElement("canvas");
small.width = 64; // drawn at 64 x 48, then each 4 x 4 block averaged to the 16 x 12 grid
small.height = 48;
const smallCtx = small.getContext("2d", { willReadFrequently: true });
smallCtx.imageSmoothingQuality = "high";

newCounter();
renderButtons();

els.start.addEventListener("click", start);
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
    app.running = true;
    loop();
  } catch (err) {
    console.warn(err);
    els.loadmsg.textContent = T.noCamera;
  } finally {
    els.start.disabled = false;
  }
}

function stop() {
  app.running = false;
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
  handle(app.counter.push(t, features));
  drawOverlay();
  drawTrace();
  renderStatus();
}

function handle(events) {
  for (const e of events) {
    if (e.type === "lock") { renderCount(true); say(String(e.reps)); }
    if (e.type === "rep") { renderCount(true); say(String(e.reps)); }
    if (e.type === "setEnd") { renderCount(false); renderSets(); }
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
  const s = app.counter.sets;
  els.sets.textContent = s.length ? T.sets(s.join(" + "), app.counter.total) : "";
}

let lastStatus = "";
function renderStatus() {
  const d = app.counter.display();
  let text;
  if (d.state === "counting") text = T.counting(d.period.toFixed(1));
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

function renderButtons() {
  els.mode.textContent = settings.mode === "body" ? T.body : T.motion;
  els.voice.textContent = settings.voice ? T.voiceOn : T.voiceOff;
}

// ------------------------------------------------------------------ helpers

function newCounter() {
  app.counter = new RepCounter(settings.mode === "body" ? POSE_OPTIONS : MOTION_OPTIONS);
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
