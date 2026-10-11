# Running-product capture

This recorder runs the original Node HTTP/SSE application and records its actual Chromium viewport. The journey covers a seeded high-press match, live play, a selected successful regain and its source events, exact outcome replay, analyst/Spanish views, and reopening the same match link.

## Run

Use Node 22+, an installed Playwright package, a compatible Chromium executable, and FFmpeg/ffprobe with H.264 and subtitle support. These are capture dependencies; the application itself still runs without installing packages. Run from this project directory:

```sh
node demo/capture.mjs \
  --out /absolute/path/to/a-new-capture-directory \
  --chromium /absolute/path/to/chromium \
  --playwright /absolute/path/to/node_modules/playwright \
  --ffmpeg /usr/bin/ffmpeg \
  --ffprobe /usr/bin/ffprobe
```

The output directory must not already exist. The recorder starts the application on an available loopback port and launches its browser in the same process environment. This also works in cloud environments where separate execution sessions cannot reach each other's loopback listeners. It does not change application routes, intercept responses, inject match state, or invoke optional commentary.

Recording lasts approximately 110 seconds. The exported MP4 uses the actual browser frames and their observed wall-clock durations, with English explanatory captions below the viewport. The captions describe the on-screen workflow; they are not generated match commentary. The clip contains no audio.

## Outputs and handoff

- `Counterpress_Compass_Running_Demo.mp4`: 1600 × 1000 H.264 video with a 1600 × 900 application viewport and English captions.
- `captions.srt`, `captions.ass`: editable caption text and actual scene timings; the ASS file fixes caption dimensions to the output canvas.
- `capture-manifest.json`: application file hashes, source commit, recorder hash, browser version, video hash, actual frame count, and optional-panel configuration read from the original `/health` route.
- `journey.json`: observed HTTP routes and on-screen clock, progress and state. The final saved/reopened match values must match or the recorder fails.
- `frames/`, `capture.concat`, `review-viewport.png`: local capture and visual-review intermediates. They need not be distributed.

Inspect the encoded duration with `ffprobe` and watch the actual clip before delivery. The [official Microsoft Inside the Game rules](https://github.com/microsoft/insidethegamehackathon/blob/main/OFFICIAL%20RULES.md) require a video **less than two minutes** showing the functioning project and require synthetic football-realistic event data. The recorder uses the original required synthetic event generator. It does not submit an entry or upload publicly.

The original Microsoft integration owner retains the Agent Framework/SDK runtime. Foundry and Opus configuration is reported from the captured runtime, and observed commentary requests are recorded separately. A capture of the core application does not imply that an unconfigured optional panel has run. The existing entrant can compose its authorized live bridge and rerun this same recorder against the integrated source before the official upload.
