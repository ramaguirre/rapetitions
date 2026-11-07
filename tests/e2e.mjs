// Browser check with Chrome's fake camera: node tests/e2e.mjs [screenshot-folder]
// 1. Motion mode on a synthetic clip with 10 reps must count exactly 10, in one set.
// 2. Body mode must load the tracker (no person in the clip) and run without console errors.
import { createRequire } from "node:module";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shots = process.argv[2] ? path.resolve(process.argv[2]) : null;
if (shots) mkdirSync(shots, { recursive: true });

const work = mkdtempSync(path.join(tmpdir(), "rapetitions-"));
const clip = path.join(work, "reps.y4m");
execFileSync("python3", [path.join(root, "tests/make_fake_video.py"), clip, "10", "2"]);

const port = 8765 + Math.floor(Math.random() * 1000);
const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], { cwd: root, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const url = `http://127.0.0.1:${port}/index.html`;

let failed = false;
const check = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if (!ok) failed = true; };

const browser = await chromium.launch({
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${clip}`],
});
try {
  for (const mode of ["motion", "body"]) {
    const ctx = await browser.newContext({ viewport: { width: 412, height: 860 }, deviceScaleFactor: 1, locale: "en-US" });
    // Headless Chrome denies the screen lock unless granted; Chrome on Android grants it without asking.
    await ctx.grantPermissions(["camera", "screen-wake-lock"]);
    const page = await ctx.newPage();
    const errors = [];
    // MediaPipe prints its own "INFO: ..." lines through console.error; those are not failures.
    page.on("console", (m) => { if (m.type() === "error" && !m.text().startsWith("INFO:")) errors.push(m.text()); });
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.addInitScript((m) => localStorage.setItem("rapetitions.settings.v2", JSON.stringify({ mode: m, voice: false })), mode);
    await page.goto(url);
    await page.click("#start");
    const t0 = Date.now();
    let s;
    // Poll with evaluate, not wait_for_function (rAF-throttled in a background window).
    while (Date.now() - t0 < (mode === "motion" ? 60000 : 25000)) {
      s = await page.evaluate(() => ({
        running: window.__rap.running, frames: window.__rap.frames, sets: window.__rap.counter.sets,
        total: window.__rap.counter.total, state: window.__rap.counter.state,
        tracker: !!window.__rap.landmarker, status: document.getElementById("status").textContent,
        count: document.getElementById("count").textContent,
        awake: document.getElementById("awake").textContent,
      }));
      if (mode === "motion" && s.sets.length) break;
      if (mode === "motion" && shots && s.state === "counting" && !page._shot) {
        page._shot = true;
        await page.screenshot({ path: path.join(shots, "counting.png") });
      }
      if (mode === "body" && s.tracker && s.frames > 40) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    if (mode === "motion") {
      check(JSON.stringify(s.sets) === "[10]", `motion mode counts 10 reps in one set (got sets ${JSON.stringify(s.sets)}, total ${s.total})`);
    } else {
      check(s.tracker, "body tracker loaded");
      check(s.frames > 40, `body mode processes frames (${s.frames})`);
      check(s.total === 0, `no person, no reps (${s.total})`);
      if (shots) await page.screenshot({ path: path.join(shots, "body-mode.png") });
    }
    check(s.awake.includes("stays on"), `screen kept on (${s.awake})`);
    check(errors.length === 0, `no console errors in ${mode} mode${errors.length ? ": " + errors.join(" | ") : ""}`);
    console.log(`     ${mode}: status "${s.status}", count ${s.count}, "${s.awake}", ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    await ctx.close();
  }
  // A phone with nothing saved, or with the old settings key, starts in Motion mode.
  const ctx = await browser.newContext({ locale: "en-US" });
  const page = await ctx.newPage();
  await page.addInitScript(() => localStorage.setItem("rapetitions.settings", JSON.stringify({ mode: "body" })));
  await page.goto(url);
  const modeText = await page.textContent("#mode");
  check(modeText === "Mode: Motion", `default mode is Motion (${modeText})`);
  await ctx.close();
} finally {
  await browser.close();
  server.kill();
}
process.exit(failed ? 1 : 0);
