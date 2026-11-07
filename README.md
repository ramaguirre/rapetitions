# RApetitions

Counts exercise reps from the phone's camera, by itself. Prop the phone up, press **Start** and
move: after about three reps the app recognises the loop, counts those first reps too, and keeps
counting out loud. Stop moving for a few seconds and the set closes; start again and a new set
begins. The screen stays on the whole time (no screensaver, no sleep).

Nothing leaves the phone: the video is analysed in the page and never stored or sent.

## Use it (Android)

1. Open the app's page in Chrome on the phone (GitHub Pages address of this repo, see below).
2. Chrome menu → **Add to Home screen** / **Install app**. It then opens full screen and works offline.
3. Press **Start**, allow the camera, step back until your body is in view, and go.

Buttons:

| Button | What it does |
|---|---|
| Mode: Motion / Body | **Motion** (default) watches the whole picture as a coarse grey thumbnail: works for any repeated movement, full body in view or not. Each thumbnail is normalised by its own brightness and contrast, so the camera's automatic exposure and white balance do not look like movement. **Body** tracks your skeleton instead (MediaPipe Pose, on the CPU). |
| Flip | Front / back camera |
| Voice | Says each number aloud |
| End set | Closes the set now, without waiting |
| Reset | Clears all sets |
| Stop | Turns the camera off |

The strip above the buttons shows the movement signal; while counting, the green band is the
threshold the signal must cross both ways for a rep.

## How it counts

1. Each frame becomes a list of numbers: in Motion mode a 16 × 12 grey thumbnail, normalised by
   its own mean and spread; in Body mode, landmark positions (in torso lengths, so distance to the
   phone does not matter).
2. Every quarter second, the last 20 s are reduced to the single direction that moves the most
   (principal component), giving one wave.
3. Autocorrelation of that wave finds the period: how many seconds until the motion repeats. A
   slow drift or fidgeting is rejected because it is not anti-correlated half a cycle later.
4. When three analyses in a row agree on the period and three cycles are in view, the app
   locks: the direction is frozen and the reps already done are counted retroactively.
5. From then on each swing through the band (down past it, back up past it) is one rep. The band
   follows slow changes in depth or tempo; 2.5 periods without a rep (at least 3 s) end the set.

All of this is in `src/counter.js`, with no browser code, so it is tested in Node.

## Develop

No build step, no npm packages. Serve the folder over http and open it:

```
python -m http.server 8000      # then http://localhost:8000 (camera works on localhost)
node --test tests/*.test.mjs    # the method, on synthetic squats, curls, fidgeting, two sets…
node tests/e2e.mjs shots/       # headless Chrome with a fake camera clip: counts 10 of 10
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
