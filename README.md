# RApetitions

Counts exercise reps from the phone's camera, by itself. Prop the phone up, press **Start** and
move: after about three reps the app recognises the loop, counts those first reps too, and keeps
counting out loud. Stop moving for a few seconds and the set closes; start again and a new set
begins. Between sets a rest clock runs from your last rep, and the voice says each
minute ("1 minute", "2 minutes"…); the sets line keeps the rests, e.g. `Sets: 12, rest 2:05, 10`.
The screen stays on the whole time (no screensaver, no sleep).

It does not need to see a body: any picture that repeats works. Put the phone at your feet,
looking up, for deadlifts; under your head for push-ups; beside a rowing machine. Reps from
about half a second to ten seconds each are counted.

Nothing leaves the phone: the video is analysed in the page and never sent. Optionally (**Clips**,
off by default) the app keeps one rep of each set as a small looping GIF, stored only on the phone
until you delete it; **Share** sends one to another app only when you press it.

## Use it (Android)

1. Open the app's page in Chrome on the phone (GitHub Pages address of this repo, see below).
2. Chrome menu → **Add to Home screen** / **Install app**. It then opens full screen and works offline.
3. Press **Start**, allow the camera, step back until your body is in view, and go.

Buttons:

| Button | What it does |
|---|---|
| Mode: Motion / Body | **Motion** (default) watches the whole picture as a coarse grey thumbnail: works for any repeated movement, full body in view or not. Each thumbnail is normalised by its own brightness and contrast, so the camera's automatic exposure and white balance do not look like movement. **Body** tracks your skeleton instead (MediaPipe Pose, on the CPU). |
| Flip | Front / back camera |
| Voice | Says each rep number and each minute of rest aloud |
| End set | Closes the set now, without waiting |
| Clips: on / off | Opens the clips: the switch to save one rep per set, and the saved clips (newest first) with **Share** and **Delete**. Also on the start screen. |
| Reset | Clears all sets and rests |
| Stop | Turns the camera off |

The strip above the buttons shows the movement signal; while counting, the green band is the
threshold the signal must cross both ways for a rep.

## How it counts

1. Each frame becomes a list of numbers: in Motion mode a 16 × 12 grey thumbnail, normalised by
   its own mean and spread; in Body mode, landmark positions (in torso lengths, so distance to the
   phone does not matter).
2. Every quarter second, the recent past is reduced to the single direction that moves the most
   (principal component), giving one wave. Several look-back windows are tried, shortest first
   (3 s up to 34 s), so the movement of walking into place does not hide a quick loop, and slow
   reps (up to 10 s) still fit three times in the longest one.
3. Autocorrelation of that wave finds the period: how many seconds until the motion repeats. A
   slow drift or fidgeting is rejected because it is not anti-correlated half a cycle later.
4. When three analyses in a row agree on the period and three cycles are in view, the app
   locks: the direction is frozen and the reps already done are counted retroactively (only those
   spaced like the rhythm). The number appears by the 3rd rep. Camera noise is kept out by
   a minimum swing size and a swing-to-jitter check.
5. From then on each swing through the band (down past it, back up past it) is one rep. The band
   follows slow changes in depth or tempo; 2.5 periods without a rep (at least 3 s) end the set.

All of this is in `src/counter.js` (rest clock: `src/rest.js`), with no browser code, so it is tested in Node.

Clips: a rep is counted as the body comes back to rest, so one rep runs from one count to the
next (rest, bottom, rest) and loops cleanly. The first rep of a set has no start, so it is never
used; of the others the app keeps the one closest to the set's typical length. While clips are on,
the last 12 s are kept in memory as 240-pixel frames at 8 per second; when the set ends, the kept
rep becomes a GIF (one palette for the clip, unchanged pixels left transparent) in a background
worker. About 0.1 to 1 MB per clip. Code: `src/clip.js`, `src/gif.js` (tested in Node),
`src/gifworker.js`, `src/clipstore.js`.

## Develop

No build step, no npm packages. Serve the folder over http and open it:

```
python -m http.server 8000      # then http://localhost:8000 (camera works on localhost)
node --test tests/*.test.mjs    # the method on synthetic data: squats, curls, fidgeting, two sets,
                                # and camera views of push-ups (phone under the head) and
                                # deadlifts (phone at the feet), 1.2 to 7.5 s per rep
node tests/e2e.mjs shots/       # headless Chrome with a fake camera clip: counts 10 of 10,
                                # rest clock, and one looping clip saved per set
```

`tests/e2e.mjs` needs Playwright and Python 3. To try it on the phone from a PC on the same Wi-Fi
the page must be https (or use Chrome's USB port forwarding to `localhost:8000`).

Files: `index.html`, `src/` (page, counter, features), `sw.js` + `manifest.webmanifest` (install
and offline), `vendor/mediapipe/` (MediaPipe Tasks Vision 0.10.21, Apache-2.0, unmodified),
`models/pose_landmarker_lite.task` (Google's pose model, Apache-2.0), `icons/` (drawn by
`tools/make_icons.py`). Bump `VERSION` in `sw.js` on every change so installed copies update.

## Publish

GitHub Pages: repository Settings → Pages → Deploy from a branch → `main`, folder `/ (root)`.
The address is then `https://<owner>.github.io/<repo>/`.
