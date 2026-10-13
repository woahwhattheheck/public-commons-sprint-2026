# Finish an existing Counterpress recording

The retained-frame encoder completes a recording that has already been captured by the original application journey. It runs with Node 22 or later, FFmpeg with the libx264 encoder and libass subtitle filter, ffprobe, and the original DejaVu Sans caption font. The encoder host does not need Playwright or Chromium.

Run one encoder for the existing private capture directory after its recorder process has closed. Use the complete directory retained by that recording's owner, including its recovery record, frame directory, caption files, prepared source and saved archives. Keep the original match and coach-review source paths with the receiving operator. The private directory carries the saved browser state needed for the recipient journey.

## Encode the retained capture

From the Counterpress application source directory:

```bash
node demo/encode-retained-capture.mjs \
  --out /absolute/private/original-capture

```

Use explicit installed executable paths when they are outside the host's normal command path:

```bash
node demo/encode-retained-capture.mjs \
  --out /absolute/private/original-capture \
  --ffmpeg /absolute/installed/bin/ffmpeg \
  --ffprobe /absolute/installed/bin/ffprobe

```

The helper reads the existing `capture-recovery.private.json` with the original `captured` or `encoded` phase. A captured input must include the complete ordered browser frames, `capture.concat` and `captions.ass`, `captions.srt` and `captions.vtt`. Each source frame and authored caption file keeps its original bytes. The saved frame intervals must match the original recovery record exactly.

The finished file is `Counterpress_Compass_Running_Demo.mp4`. It retains the recorder's 1600 × 900 application view, 100-pixel caption band, 24 frames per second, H.264 encoding, CRF 20 and original duration. The output must stay below two minutes and within one tenth of a second of its actual captured duration.

FFmpeg decoder, filter and encoder threads are set to one. The helper adds x264's `zerolatency` tuning to the recorder's `veryfast` preset. This disables lookahead buffering and B frames; the original scene timing and captions are retained. Compression can produce a larger MP4 than the recorder's default tuning. Large file hashes are read as a stream so a complete recording is not held in Node's memory.

The helper prints an `encoded` result with the actual output size, SHA-256, duration and retained browser-frame count. It saves the same `phase: encoded` and `video` fields understood by the original recorder.

## Continue the original recipient journey

Return the complete updated capture directory to its original receiving operator. On the host with the application source, Playwright, Chromium and the original match/review files, resume the same integrated recording:

```bash
node demo/capture.mjs \
  --out /absolute/private/original-capture \
  --chromium /absolute/installed/chromium \
  --journey integrated \
  --match /absolute/original/match.json \
  --review /absolute/original/coach-review.json \
  --resume true

```

Carry the original `--recap-match` selection when that recording used one. Supply its existing `--playwright` module location and FFmpeg/ffprobe paths when needed.

The original recorder checks the completed video, reopens the saved application state, attaches the recording to the broadcast handover, and continues its existing independent recipient import and desktop/phone review. The original recorded-source identity remains attached to the capture; the receiving source inventory describes the source actually used to finish the handover.

For an existing core recording, resume with its original `--journey core` options. The source directory, journey mode, selected matches and authored captions belong to the same saved operation.

## Resume after interruption

Rerun the same encoder command with the same capture directory. The helper retains its staging directory and input binding in the original private recovery record.

If an encoding process ends before its MP4 is complete, the interrupted bytes remain in that private staging directory and the next run encodes the same original input. A complete staged video is reopened and checked before reuse. Once its hash, format and duration are ready, publication can resume without another encode.

A previous partial file at the final video path is retained inside the staging directory before the complete video is linked into place. A file that changes after this encoding starts is preserved for its current recording operation. Every frame and caption is checked again before the encoded checkpoint is saved.

An already encoded recording is reopened and its existing video identity checked. The final recipient operation still runs through the original recorder. It owns completion of the exported handover and removal of the original frame/recovery files. Keep the private encoding staging directory until the recording's owner has completed that receiving operation and retained the finished delivery.

## Encoding references

- [FFmpeg libx264 options](https://ffmpeg.org/ffmpeg-codecs.html#libx264_002c-libx264rgb) define the thread, preset, tune, CRF and lookahead controls used by the native encoder.
- [x264 parameter implementation](https://github.com/mirror/x264/blob/master/common/base.c) defines the `veryfast` preset and `zerolatency` tuning.
