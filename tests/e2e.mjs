// Browser check with Chrome's fake camera: node tests/e2e.mjs [screenshot-folder]
// 1. Motion mode on a synthetic clip with 10 reps must count exactly 10, in one set.
// 2. Body mode must load the tracker (no person in the clip) and run without console errors.
import { createRequire } from "node:module";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
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
    await page.addInitScript((m) => {
      localStorage.setItem("rapetitions.settings.v2", JSON.stringify({ mode: m, voice: true, clips: m === "motion" }));
      // Record what the voice says instead of speaking.
      window.__said = [];
      if (window.speechSynthesis) {
        speechSynthesis.speak = (u) => window.__said.push(u.text);
        speechSynthesis.cancel = () => {};
      }
    }, mode);
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
      // Rest clock: visible after the set, and the voice says the minutes (jump the rest forward).
      const rest1 = await page.evaluate(() => ({ hidden: document.getElementById("rest").hidden, text: document.getElementById("rest").textContent }));
      check(!rest1.hidden && /^Rest 0:\d\d$/.test(rest1.text), `rest clock shown after the set (${rest1.text})`);
      await page.evaluate(() => { window.__rap.rest.since -= 59; });
      await new Promise((r) => setTimeout(r, 1500));
      const said = await page.evaluate(() => window.__said.filter((x) => x.trim()));
      const rest2 = await page.textContent("#rest");
      check(said.includes("1 minute"), `voice says "1 minute" (said: ${said.join(", ")})`);
      check(/^Rest 1:0\d$/.test(rest2), `rest clock passes one minute (${rest2})`);
      const nums = said.filter((x) => /^\d+$/.test(x)).map(Number);
      check(nums.at(-1) === 10 && nums.every((n, i) => i === 0 || n === nums[i - 1] + 1), `voice counts the reps up to 10 (${nums.join(" ")})`);
      if (shots) await page.screenshot({ path: path.join(shots, "resting.png") });
      // The clip loops: the second set stops the clock; once it ends, the rest shows between sets.
      let s2;
      for (const t1 = Date.now(); Date.now() - t1 < 60000;) {
        s2 = await page.evaluate(() => ({ sets: window.__rap.counter.sets, resting: window.__rap.rest.resting,
          rests: window.__rap.rest.rests, line: document.getElementById("sets").textContent }));
        if (s2.sets.length >= 2) break;
        await new Promise((r) => setTimeout(r, 250));
      }
      check(s2.rests.length === 1 && s2.rests[0] > 60 && s2.rests[0] < 90, `second set ends the rest (${s2.rests.map((x) => x.toFixed(0))} s)`);
      check(/^Sets: 10, rest 1:\d\d, 10 · total 20$/.test(s2.line), `rest shown between sets ("${s2.line}")`);
      // Clips: one looping GIF per set, one rep long (the clip's period is 2 s), kept on the phone.
      for (const t1 = Date.now(); Date.now() - t1 < 10000;) {
        if ((await page.evaluate(() => window.__rap.clipsSaved)) >= 2) break;
        await new Promise((r) => setTimeout(r, 250));
      }
      await page.click("#clipsbtn");
      await page.waitForSelector("#cliplist li img");
      await page.waitForFunction(() => [...document.querySelectorAll("#cliplist img")].every((i) => i.complete && i.naturalWidth));
      const panel = await page.evaluate(() => ({
        items: document.querySelectorAll("#cliplist li").length, info: document.getElementById("clipsinfo").textContent,
        img: [...document.querySelectorAll("#cliplist img")].map((i) => `${i.naturalWidth}x${i.naturalHeight}`),
        line: document.querySelector("#cliplist li").textContent,
      }));
      check(panel.items === 2, `two clips saved, one per set (${panel.info}; ${panel.img.join(", ")})`);
      check(/10 reps · 2\.\d s per rep/.test(panel.line), `clip labelled with the set ("${panel.line}")`);
      const bytes = await page.evaluate(async () => {
        const { listClips } = await import("./src/clipstore.js");
        const [c] = await listClips();
        return Array.from(new Uint8Array(await c.gif.arrayBuffer()));
      });
      const gifPath = path.join(work, "clip.gif");
      writeFileSync(gifPath, Buffer.from(bytes));
      if (shots) writeFileSync(path.join(shots, "clip.gif"), Buffer.from(bytes));
      const info = JSON.parse(execFileSync("python3", ["-c", `
import sys, json
from PIL import Image
im = Image.open(sys.argv[1]); d = 0
for f in range(im.n_frames):
    im.seek(f); d += im.info.get("duration", 0)
print(json.dumps({"n": im.n_frames, "ms": d, "size": im.size, "loop": im.info.get("loop")}))`, gifPath], { encoding: "utf8" }));
      check(info.n >= 10 && info.n <= 20 && Math.abs(info.ms - 2000) < 300 && info.loop === 0,
        `clip is one looping rep: ${info.n} frames, ${info.ms} ms, ${info.size.join("x")}, ${(bytes.length / 1e3).toFixed(0)} kB`);
      if (shots) await page.screenshot({ path: path.join(shots, "clips.png") });
      await page.click("#clipsclose");
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
  const clipsText = await page.textContent("#clipsbtn");
  check(clipsText === "Clips: off", `clips are off by default (${clipsText})`);
  await ctx.close();
} finally {
  await browser.close();
  server.kill();
}
process.exit(failed ? 1 : 0);
