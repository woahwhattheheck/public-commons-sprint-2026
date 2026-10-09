# Hearthline: record the real MCP workflow

This loopback-only host connects a browser to the existing, unmodified Hearthline
MCP server, reads and renders its original MCP App resource, and records an actual
mission through approval, execution, process restart and idempotent replay.
It is not the separate browser-only interaction simulator.

## Run

From the repository root, with Node.js 20+, Python 3.10+, Chromium and FFmpeg:

```sh
python3 -m pip install playwright==1.57.0
python3 -m playwright install --with-deps chromium
SOURCE_COMMIT="$(git rev-parse HEAD)" python3 tools/hearthline-live-demo/record.py \
  --output /tmp/hearthline-live-demo
```

The output directory must not already exist. `--browser /path/to/chromium` selects
an existing browser; otherwise an installed Chromium/Chrome or Playwright browser
is used. For manual interaction, run `node tools/hearthline-live-demo/server.mjs`
and open `http://127.0.0.1:8790`. `DEMO_PORT` changes the loopback port.

Alternatively dispatch the manual **Hearthline live demo recording** workflow on
a reviewed ref and retrieve its `hearthline-live-demo-<run-id>` artifact. It runs
one demonstration, not the full application regression suite. The workflow has
read-only repository permission and no secret configuration. Source remains in
the original repository; no new entrant or provider account is created.

## Evidence and limitations

The browser performs the real MCP initialize/initialized handshake and tool calls.
The backend uses the production store, orchestrator, authority logic and transport.
A real Node child process is terminated and replaced while its private temporary
state file is retained. The recording checks these observed outcomes:

- Execution without approval is rejected and creates no local outbox item.
- Explicit approval followed by execution creates one outbox item and one receipt.
- A new server process and MCP session recover the mission and replay the same
  receipt ID and digest, without creating a duplicate outbox item.
- The shopping action returns `prepared_not_purchased`, not a purchase.

The original MCP App receives actual server-returned mission data. MP4 frames are
captured from the running browser, and their real elapsed intervals are preserved.
`evidence.json` holds actual response data; `RECORDING_RECEIPT.json` records source
commit, hashes, media duration, frame count and assertions. The silent video has
visible explanatory captions; it is not a live voice/Alexa demonstration.

**Synthetic inputs:** weather, inventory and household location. No live NWS data,
Alexa/AWS service, merchant, payment or message-delivery provider is called by the
demo. The recording host creates fresh temporary state and cannot select an
existing production store. Its host/origin restrictions and loopback binding are
not a public deployment design. Browser or organizational policies must remain
intact; run recording only on a runner authorized for local application execution.

Publishing a GitHub artifact is not a Devpost submission or public video-hosting
receipt. Review the actual video, then use the original entrant's authorized
YouTube/Vimeo and Devpost routes. Do not mark the entry complete without those
provider receipts. This contribution does not alter source licenses, authorship,
entrant identity, or any existing prize/payment claim.
