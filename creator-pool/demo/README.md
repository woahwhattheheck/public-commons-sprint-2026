# Record the complete Creator Pool demo

The recorder launches the original local application and records one continuous
browser journey. Campaign changes use the existing UI controls; state checkpoints
read the original API and contracts. The output includes raw video, timed captions,
the final contract state and the observed requests.

## Scenario

1. The sponsor creates a 250 CPDEMO campaign with a 100 CPDEMO reward and funds it.
2. Creator A submits an attributed public source example.
3. Creator B selects its identity inside the form, enters a separate draft,
   refreshes and submits the preserved draft.
4. The sponsor explicitly reviews and reserves both 100 CPDEMO rewards.
5. Creator A claims its reward.
6. The sponsor explicitly closes the campaign and receives the unused 50 CPDEMO.
7. Creator B claims its reserved 100 CPDEMO after closure.
8. The sponsor views the final ledger: 250 funded = 200 paid + 50 refunded,
   with no remaining reserve or available balance.

CPDEMO is the original non-monetary local EVM asset. This sequence does not deploy
to a public chain or use a connected wallet. Approval and payment remain separate
steps, including the explicit sponsor confirmations.

## Run

Use Node 20 or newer and the original backend dependencies described in
[the product README](../README.md). The recording machine also needs Playwright
with Chromium and its video encoder. FFmpeg is used only for the final MP4
conversion. Existing installed runtimes can be selected below; no hosted CI is
involved.

Run from the repository root, using fresh output and local-chain directories:

```sh
export CP_CAPTURE_SOURCE="$(git rev-parse HEAD)"
export CP_CAPTURE_OUTPUT="/absolute/path/to/new-creator-pool-capture"
export CP_CAPTURE_DATA_DIR="/absolute/path/to/new-creator-pool-state"
export PLAYWRIGHT_MODULE="/absolute/path/to/playwright-core/index.mjs"
export CHROMIUM_EXECUTABLE="/absolute/path/to/chromium"
export PORT=8877
export RPC_URL="http://127.0.0.1:8855"
node creator-pool/demo/record-live-demo.mjs
```

Set the two executable/module paths to the installed runtime on that machine.
When Playwright and its Chromium are already available through ordinary Node
resolution, omit those two variables. Use the product revision that matches the
checkout being recorded: CP_CAPTURE_SOURCE identifies that product and supplies
the public source links used in the two attributed example submissions.

The original recording used product revision
afcc48eccc32859762b57236f159c1f0b4bce1a6. That historical value remains the
script's default for reproduction; set CP_CAPTURE_SOURCE for a later product
revision. The publication of this recorder adapts only its backend import and
product-root location from the original executed file.

At the configured loopback RPC port, the original persistent launcher creates
the local deployment in CP_CAPTURE_DATA_DIR. The recorder refuses a
nonempty campaign collection. Preserve an earlier capture's data and use another
directory for a new take. Choose unused API/RPC ports when another local demo is
running.

Keep the launcher and recorder in the same command session. Some cloud execution
environments share files while isolating process IDs and loopback networking
between sessions. This script starts its backend and browser together, so it does
not depend on a separate session's localhost connection.

The 1600×900 capture writes:

| File | Content |
| --- | --- |
| Raw WEBM, named in capture.json | Original continuous browser recording |
| Creator-Pool-Live-Demo.srt | Captions timed to the actual observed scenes |
| capture.json | Product revision, duration, scenes, real state checkpoints, UI mutation responses and errors |
| final-state.json | Original final API/contract readback |
| final-accounting.png | Final visible sponsor ledger |
| failure.png / failure-ui.txt, on failure | The actual page at the point of failure |

The process closes its browser and stops only the launcher-owned child processes.
An unsuccessful journey returns a nonzero exit status and preserves its output.
The script also rejects a continuous take over 180 seconds. The current
[official competition FAQ](https://colosseum.com/hackathon) specifies a product
demo of at most three minutes and a separate two-to-three-minute presentation;
check the current event instructions before submitting either asset.

## Convert the completed take

Work in the capture directory so caption paths remain simple:

```sh
cd "$CP_CAPTURE_OUTPUT"
RAW_VIDEO="$(node -e 'const fs=require("node:fs"); process.stdout.write(JSON.parse(fs.readFileSync("capture.json","utf8")).rawVideo)')"
ffmpeg -n -i "$RAW_VIDEO" \
  -vf "subtitles=Creator-Pool-Live-Demo.srt:force_style='FontName=DejaVu Sans,FontSize=18,Alignment=2,MarginV=28,Outline=1'" \
  -c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p \
  -an -movflags +faststart Creator-Pool-Live-Demo.mp4
ffprobe -v error -show_entries format=duration,size -of json Creator-Pool-Live-Demo.mp4
```

Keep the raw WEBM and SRT with the MP4. Review the rendered captions and final
accounting in the produced video. The recorder's state and request log identify
what actually happened; conversion changes presentation only.
