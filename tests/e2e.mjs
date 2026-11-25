// Browser check with Chrome's fake camera: node tests/e2e.mjs [screenshot-folder]
// 1. Motion mode on a synthetic clip with 10 reps must count exactly 10, in one set.
// 2. Body mode must load the tracker (no person in the clip) and run without console errors.
// 3. A program: today's session walked step by step (timer, then two counted sets), the pain
//    question, the log, the history, the morning question, a suggestion and an unfinished session.
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
  // ---------------------------------------------------------------- 3. following a program
  {
    const ctx = await browser.newContext({ viewport: { width: 412, height: 860 }, deviceScaleFactor: 1, locale: "en-US" });
    await ctx.grantPermissions(["camera", "screen-wake-lock"]);
    const page = await ctx.newPage();
    const errors = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("dialog", (d) => d.accept());
    await page.addInitScript(() => {
      localStorage.setItem("rapetitions.settings.v2", JSON.stringify({ mode: "motion", voice: true, clips: false }));
      if (!localStorage.getItem("rapetitions.program.v1")) {
        const p = new Date(), day = `${p.getFullYear()}-${String(p.getMonth() + 1).padStart(2, "0")}-${String(p.getDate()).padStart(2, "0")}`;
        localStorage.setItem("rapetitions.program.v1", JSON.stringify({
          program: { name: "Test squats", days: [1, 2, 3, 4, 5, 6, 7], unit: "kg",
            checkins: { pain: true, morning: true }, clean: { maxPain: 3 },
            stages: [{ name: "Base", steps: [{ type: "timer", name: "Warm-up", minutes: 0.05 },
              { type: "exercise", name: "Squats", sets: 2, reps: 10, tempo: 4, weight: true }] }] },
          progress: { programId: "test-squats", startDay: day, stage: 0, since: day, weights: { Squats: 5 }, snoozed: null },
        }));
      }
      window.__said = [];
      if (window.speechSynthesis) {
        speechSynthesis.speak = (u) => window.__said.push(u.text);
        speechSynthesis.cancel = () => {};
      }
    });
    await page.goto(url);
    await page.evaluate(() => window.__rap.ready);
    const today = await page.evaluate(() => ({ hidden: document.getElementById("today").hidden,
      btn: document.getElementById("startplan").textContent, what: document.getElementById("todaywhat").textContent,
      weight: document.querySelector("#todaysteps input")?.value, free: document.getElementById("start").textContent }));
    check(!today.hidden && today.btn === "Start today's session" && today.what === "Today: session planned",
      `today's plan on the start screen ("${today.what}", "${today.btn}")`);
    check(today.weight === "5" && today.free === "Count freely", `weight carried forward (${today.weight}), free count still offered`);
    if (shots) await page.screenshot({ path: path.join(shots, "today.png") });
    await page.click("#startplan");
    let g;
    for (const t1 = Date.now(); Date.now() - t1 < 15000;) {
      g = await page.evaluate(() => ({ i: window.__rap.guided?.i, timer: !document.getElementById("timer").hidden,
        plan: document.getElementById("plan").textContent, status: document.getElementById("status").textContent }));
      if (g.timer && !page._t && shots) { page._t = true; await page.screenshot({ path: path.join(shots, "warmup.png") }); }
      if (g.i === 1) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    check(g.i === 1 && !g.timer, `warm-up timer runs out, then the first exercise (${g.plan})`);
    let ask = false;
    for (const t1 = Date.now(); Date.now() - t1 < 90000;) {
      const a = await page.evaluate(() => ({ ask: !document.getElementById("ask").hidden, state: window.__rap.counter.state,
        set: window.__rap.guided?.slot()?.set }));
      if (a.state === "counting" && a.set === 2 && shots && !page._c) { page._c = true; await page.screenshot({ path: path.join(shots, "guided.png") }); }
      if (a.ask) { ask = true; break; }
      await new Promise((r) => setTimeout(r, 250));
    }
    check(ask, "both sets counted, then the pain question");
    if (shots) await page.screenshot({ path: path.join(shots, "pain.png") });
    await page.click("#askopts button:text-is('2')");
    await page.waitForSelector("#summary:not([hidden])");
    if (shots) await page.screenshot({ path: path.join(shots, "summary.png") });
    const rec = await page.evaluate(async () => {
      const { listSessions } = await import("./src/logstore.js");
      return (await listSessions())[0];
    });
    const sq = rec.steps[1];
    check(JSON.stringify(sq.done.map((d) => d.reps)) === "[10,10]" && rec.pain === 2 && sq.weight === 5 && rec.steps[0].doneTimer,
      `session logged: ${sq.done.map((d) => d.reps)} reps at ${sq.weight} kg, pain ${rec.pain}`);
    check(sq.done.every((d) => Math.abs(d.sec - 2) < 0.3), `seconds per rep logged (${sq.done.map((d) => d.sec)})`);
    const said = await page.evaluate(() => window.__said);
    check(said.includes("Next: Squats") && said.some((x) => x.endsWith(", slower")) && said.includes("Session complete"),
      `voice: next exercise, tempo, end (${said.filter((x) => !/^\d+$/.test(x) && x.trim()).join(" | ")})`);
    await page.click("#summary .close");
    const after = await page.textContent("#todaywhat");
    check(after === "Today's session is done", `start screen knows today is done ("${after}")`);
    await page.click("#historybtn");
    const hist = await page.evaluate(() => ({ cards: document.querySelectorAll("#historybody .card").length,
      stats: [...document.querySelectorAll("#historybody .stats b")].map((b) => b.textContent) }));
    // One session of the week's planned ones (every day from today to Sunday): that share of the reps.
    const [d1, pl] = hist.stats[0].split("/").map(Number);
    check(hist.cards === 1 && d1 === 1 && hist.stats[1] === `${Math.round(100 / pl)}%`, `history: one session, stats ${hist.stats.join(" / ")}`);
    if (shots) await page.screenshot({ path: path.join(shots, "history.png"), fullPage: true });
    await page.click("#history .close");
    // Next day: the session moves to yesterday; the morning question comes up on opening.
    await page.evaluate(async (r) => {
      const { putSession } = await import("./src/logstore.js");
      const { addDays } = await import("./src/program.js");
      const p = JSON.parse(localStorage.getItem("rapetitions.program.v1"));
      p.progress.startDay = p.progress.since = addDays(r.day, -1);
      localStorage.setItem("rapetitions.program.v1", JSON.stringify(p));
      await putSession({ ...r, day: addDays(r.day, -1), start: new Date(Date.now() - 86400000).toISOString() });
    }, rec);
    await page.reload();
    await page.waitForSelector("#ask:not([hidden])");
    const q = await page.textContent("#askq");
    check(/worse this morning/.test(q), `morning question on opening ("${q}")`);
    if (shots) await page.screenshot({ path: path.join(shots, "morning.png") });
    await page.click("#askopts button:text-is('A bit')");
    await page.waitForSelector("#suggest:not([hidden])");
    const sug = await page.textContent("#suggesttext");
    check(/worse the morning after/.test(sug), `worse morning: suggests easing off ("${sug}")`);
    if (shots) await page.screenshot({ path: path.join(shots, "suggest.png") });
    // A session cut short (app closed mid-session) is logged as unfinished on the next opening.
    await page.evaluate(async () => {
      const { GuidedSession } = await import("./src/session.js");
      const g = new GuidedSession({ programId: "test-squats", programName: "Test squats", stage: 0, stageName: "Base", planned: true,
        unit: "kg", steps: [{ type: "exercise", name: "Squats", sets: 2, reps: 10 }] }, new Date().toISOString());
      g.recordSet(7, 2);
      localStorage.setItem("rapetitions.draft.v1", JSON.stringify({ ...g.draft(), saved: new Date().toISOString() }));
    });
    await page.reload();
    await page.evaluate(() => window.__rap.ready);
    await page.click("#historybtn");
    const unf = await page.evaluate(() => [...document.querySelectorAll("#historybody .card .muted")].map((e) => e.textContent).join(" | "));
    check(/not finished/.test(unf) && /7 of 20 planned reps/.test(unf), `unfinished session recovered (${unf})`);
    await page.click("#history .close");
    // Any program: switch to the built-in Achilles template.
    await page.click("#programbtn");
    await page.click("#programbody button:text-is('Follow this program')");
    const prog = await page.evaluate(() => document.querySelector("#programbody h3").textContent);
    check(prog === "Achilles rehabilitation", `template followed (${prog})`);
    if (shots) await page.screenshot({ path: path.join(shots, "program.png"), fullPage: true });
    await page.click("#program .close");
    const steps = await page.evaluate(() => [...document.querySelectorAll("#todaysteps .what")].map((e) => e.firstChild.textContent));
    check(steps.length === 3 && steps[1] === "Standing calf raises", `Achilles session on the start screen (${steps.join(", ")})`);
    if (shots) await page.screenshot({ path: path.join(shots, "achilles.png") });
    check(errors.length === 0, `no console errors with a program${errors.length ? ": " + errors.join(" | ") : ""}`);
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
