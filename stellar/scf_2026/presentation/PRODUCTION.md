# Compose a retained product film

`render.py` preserves the original frame capture and also reads ordered chapter
clips. It uses the Python standard library, FFmpeg with libass/libx264, ffprobe,
and an installed font (DejaVu Sans by default). It opens no browser, creates no
voice or presenter likeness, and writes no intermediate screenshot sequence.

## Capture/2 recorder contract

Retain `film`, `chapters`, and `errors` from the original recorder. Each recorded
chapter must have its original ID, title, label, captions, and numeric `start`
and `end`. The film and recorded chapters have the same order and IDs. Supply
one video-only H.264/yuv420p MP4 per chapter in that order:

```json
{
  "schema": "stellar-forge.presentation.capture/2",
  "film": {
    "title": "Product presentation",
    "subtitle": "Recorded product walkthrough",
    "sourceRepository": "https://github.com/OWNER/REPOSITORY",
    "sourceCommit": "ACTUAL_SOURCE_COMMIT",
    "chapters": [{"id":"seller","title":"Inspect the merchant","label":"ORIGINAL UI","captions":["The retained operation and its complete terms."]}]
  },
  "chapters": [{"id":"seller","start":0,"end":4}],
  "clips": [{"id":"seller","file":"clips/seller.mp4","frames":24,"fps":6,"width":1440,"height":700,"duration":4,"sha256":"ACTUAL_CLIP_SHA256"}],
  "errors": [],
  "sources": [{"label":"Original observation","url":"ACTUAL_SOURCE_URL"}],
  "sourceFacts": [{"label":"Observed result","value":"ACTUAL_RETAINED_VALUE","source":"ACTUAL_SOURCE_URL"}],
  "interpretation": "Describe the recorded run and separately retained material precisely."
}
```

Example placeholders must be replaced with the actual capture data. Chapter
presentation fields may live in `film.chapters`; recorded fields override them.
Media paths are relative to the capture directory and remain beneath it.

Feed accepted browser screenshot buffers directly into a chapter encoder. The
following command expects JPEG frames on stdin; the recorder owns that pipe:

```sh
ffmpeg -hide_banner -loglevel warning -nostdin -y \
  -threads 1 -filter_threads 1 -f image2pipe -framerate 6 -vcodec mjpeg -i pipe:0 \
  -an -c:v libx264 -preset ultrafast -crf 19 -threads 1 -pix_fmt yuv420p \
  -x264-params 'ref=1:bframes=0:rc-lookahead=0:sync-lookahead=0' \
  -movflags +faststart clips/seller.mp4
```

All clips use the same frame rate, dimensions and MP4 time base. Close each pipe,
wait for the actual encoder exit, and read its encoded frame count with ffprobe.
Set `duration = frames / fps`; derive chapter boundaries cumulatively from those
accepted counts, including the final end. Hash the actual completed MP4. A stream
of 24 accepted frames at 6 fps has a four-second timeline, regardless of capture
wall time. The compositor checks those values against each original MP4 before
joining it. Existing image captures keep their original `frames:[{file,at}]`
and recorded chapter clock without conversion.

## Render and inspect

```sh
python3 -B render.py /absolute/completed-capture
python3 -B render.py /absolute/completed-capture --output /absolute/delivery
```

The result retains the original filenames:

- `stellar-forge-scf46-presentation.mp4`: 1920×1080, 24 fps, H.264/yuv420p.
- `stellar-forge-presentation.vtt`: timed, selectable caption track.
- `stellar-forge-presenter-script.txt`: exactly the caption wording and timing.
- `stellar-forge-sources.md`: the capture's source links and retained facts.
- `stellar-forge-render.json`: actual ffprobe result, bytes, SHA-256, input clip
  identities and counts, chapter timing, caption rates, and companion identities.

`captions.ass` retains the styled track; `render.log` holds encoder diagnostics.
`inputs.ffconcat` points to the retained inputs and is a local working file.
Keep the input clips to reproduce a render; only the completed video and its
four named companions are needed for viewing and handover.

The unchanged product viewport fits inside 1728×840 without stretching. The
outer frame is grayscale, with a 100-pixel header and a 140-pixel caption band.
Captions retain word order, split into at most two lines, and receive exposure
proportional to their text length. The report identifies cues above 20 characters
per second or below two seconds; plan around 17 characters per second and adjust
the film's chapter durations before a new recording when needed. The compositor
does not silently shorten the narration or stretch recorded interactions.

For a caption/script preflight without an encode, use a separate output folder:

```sh
python3 -B render.py /absolute/completed-capture --prepare-only \
  --output /absolute/caption-review
```

`--font` selects an installed font family. `--ffmpeg` and `--ffprobe` select
existing executables. `--preset` and `--crf` retain explicit encoding controls.
The compositor uses two decoder/filter/encoder threads with one reference frame,
no B-frames and no lookahead, so memory does not grow with the film's length.
Use the existing native capacity runner for the complete recording/rendering
operation; both source media and outputs remain in its declared paths.

## Source facts and failure recovery

`sourceFacts` accepts either an object or an array of `{label,value,source?}`.
Explicit source facts replace the legacy top-level transaction/response fields;
no transaction, amount, observation time or run interpretation is hardcoded into
the successor renderer. `sources` combines actual film and capture links, with
URL deduplication. The script does not include private capture configuration,
workspace capabilities, credentials, or browser session material. The recorder
is responsible for selecting the actual public facts and visible content.

Artifacts are written in a temporary directory beneath the destination and each
completed file is atomically replaced; the final manifest is published last.
An encoder failure retains `render-failed.log` and `render-failed.json` with the
native return code, while preserving any earlier completed video. Resolve the
actual failure and rerender from the same retained clips; no browser or purchase
replay is needed. The original native job's command/result remains authoritative
when it has already dispatched; keep that operation's record during recovery.
