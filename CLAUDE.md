# RApetitions: working notes

Installable web app (PWA) for Android first: counts exercise reps from the camera, keeps the screen
on. Same pattern as take_recorder: plain HTML/JS, no build, GitHub Pages, works offline.

## Rules
- The method lives in `src/counter.js` and `src/features.js`, with no browser APIs, so Node tests
  cover it. Change the method there and add a synthetic test for each new case.
- `node --test tests/*.test.mjs` and `node tests/e2e.mjs <folder>` must pass; look at the screenshots.
- Headless Chrome denies the screen wake lock unless the test grants `screen-wake-lock`.
  Poll with `page.evaluate` in a loop (rAF-based waits throttle off-screen).
- MediaPipe is vendored (`vendor/mediapipe`, `models/`), same-origin, so the app works offline.
  Do not switch to a CDN.
- Bump `VERSION` in `sw.js` whenever a shipped file changes.
- Nothing is uploaded; keep it that way. The one recording is optional (director, 2026-11-10): a
  looping clip of one rep per set, off by default, kept only on the phone (IndexedDB), kept until the
  user deletes it, and sent elsewhere only when the user presses Share.
- Clip choice and frames are in `src/clip.js`, the GIF encoder in `src/gif.js` (no browser APIs,
  tested in Node); the encoder runs in a worker so counting never stalls.
- Programs and adherence (director, 2026-11-25): every session is logged on the phone; a program is
  data, not code, so anyone's program works (the Achilles plan is only the first template). One
  program at a time. Volume, frequency and consistency (clean weeks) are measured; what counts as
  clean is editable per program; the next stage is only suggested, after 2 clean weeks by default,
  and the user confirms. Logic in `src/program.js`, `src/session.js`, `src/progress.js` (no
  browser APIs, tested in Node). The log leaves the phone only through Export.

## Tracking (RAMonitor)

Tracked in `ramaguirre/ramonitor` (private), file `projects/rapetitions.md`. End every session, wherever it
runs, with a clear commit or PR message saying what changed, what is next, and what needs the
director. A daily catch-up updates RAMonitor from those messages. No paths or confidential data in messages.
