# Running-product capture and editable delivery

The recorder runs the original Node HTTP/SSE application and records its actual Chromium viewport. Its integrated journey uses an original completed match with a retained Agent Framework explanation and the complete high-press/low-block coach review. It joins the saved explanation, H10 recap and replay playlist, coach comparison, broadcaster editor and portable handover.

## Run the complete journey

Use Node 22 or later, an installed Playwright package, Chromium, and FFmpeg/ffprobe with H.264 and subtitle support. These are recorder dependencies; the application itself needs no package installation.

```sh
node demo/capture.mjs \
  --out /absolute/path/to/a-new-capture-directory \
  --chromium /absolute/path/to/chromium \
  --playwright /absolute/path/to/node_modules/playwright \
  --match /absolute/path/to/original-accepted-match.json \
  --review /absolute/path/to/original-coach-review.json
```

The output directory must not exist. The default integrated replay profile is the included demo/player-recap-high-press-2026.json. The accepted match and this profile must contain the same complete original match. The original explanation remains unchanged.

The complete journey:

1. Opens the original saved explanation at its recorded match position.
2. Shows its source plays, executed match-state tool call and two provider turns.
3. Opens H10's complete recap and replays the recorded 52:44.6–52:49.6 recovery.
4. Saves the playlist and notes, then compares the complete original high-press and low-block matches.
5. Builds the original H10 five-play recovery story, selects its e632–e636 recovery, and authors two source-linked captions with video times from the actual captured player sequence.
6. Reopens the saved broadcaster workspace and its standalone event replay.
7. Closes the recording browser and server before encoding.
8. Restarts the original persistent application, opens the actual encoded MP4, saves its real duration, and downloads the complete editable delivery.
9. Imports the coach review into another browser collection, edits the recipient's independent copy, and reopens the original saved explanation and standalone replay.

The recorded journey lasts about 112 seconds. It retains the original browser frames and observed wall-clock intervals. English chapter captions appear below the application viewport. The film has no audio. The separate broadcaster VTT contains match commentary timed to this same video.

The recipient operation runs after encoding and is outside the competition clip. It also checks the player, explanation and broadcaster layouts at 390 pixels. Its screenshots stay in the private review-images directory.

## Delivery files

| File | Use |
| --- | --- |
| Counterpress_Compass_Running_Demo.mp4 | Actual working product, 1600 × 1000 H.264 |
| READ_ME.html | Start here; film, review links and application instructions |
| Counterpress_Broadcast_Handover.html | Standalone original-event replay and complete editable-match download |
| Counterpress_Broadcast_Match.json | Original match, retained explanation, recap, playlist and edited broadcaster cues |
| Counterpress_Broadcast_Captions.vtt | Match captions timed to the delivered recording |
| Counterpress_Coach_Review.json | Both complete matches and their saved review state |
| Counterpress_Player_Recap.html / .json | H10's source-based player recap and half-by-half comparison |
| captions.srt / .vtt / .ass | Editable chapter captions with observed recording times |

capture-manifest.json and journey.json describe the actual source, frames, application restarts, receiving operation and process closure. Collection capability keys remain in process memory and the private application store; they are excluded from the deliverable. Completed frame intermediates are removed after encoding and receiving. The prepared and review-images directories are local working material.

To retain the original basic seeded-player journey, omit --match and --review or use --journey core. That mode takes about 110 seconds and does not require a completed Agent Framework result.

## Competition handoff

The [official Microsoft Inside the Game rules](https://github.com/microsoft/insidethegamehackathon/blob/main/OFFICIAL%20RULES.md) require a functioning-project video strictly shorter than two minutes and football-realistic synthetic event data. This recorder uses the original project events. It does not change model configuration, invoke a new model call, publicly upload the video or submit the entry.

The entrant retains the public video destination and platform submission. This complete source and recorded delivery can be used directly for that handoff.

For restricted containers using the Sparticuz Chromium build, append `--browser-process-mode single` to keep the browser and renderer in one process. The default keeps the browser’s standard process model. Both modes operate the same application and editable recipient journey.

## Continue an interrupted encode or handover

After the full browser recording, the recorder saves its frame intervals, journey state and private collection state before closing the browser. If encoding or recipient delivery is interrupted, run the same command with the same output and original inputs, adding `--resume true`. It continues from the completed frames, or from the completed video when encoding already finished.

The decoder, filter graph and H.264 encoder each use one worker thread to keep the recording deliverable on a shared machine. The private `capture-recovery.private.json` belongs only to that local operation; it contains collection access state, must stay private and must be excluded from deliverables. The recorder removes it after successful delivery. Export only the named public handover files and application source.
