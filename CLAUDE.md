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
- Nothing is recorded or uploaded; keep it that way.

## Tracking (RAMonitor)

Tracked in `ramaguirre/ramonitor` (private), file `projects/rapetitions.md`. End every session, wherever it
runs, with a clear commit or PR message saying what changed, what is next, and what needs the
director. A daily catch-up updates RAMonitor from those messages. No paths or confidential data in messages.
