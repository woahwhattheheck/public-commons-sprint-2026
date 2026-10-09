# Hearthline: live-MCP browser demonstration

A functioning browser client for the existing `../hearthline-alexa-mcp` production MCP implementation. It is deliberately separate from the existing synthetic browser state-machine simulator and does not modify the core runtime, store, authority logic, contributor notices, or entrant rights.

## Run

From the repository root, with Node.js 20 or later:

```sh
node hearthline-browser-demo/server.mjs
```

Open exactly `http://127.0.0.1:8790/`. The host accepts only its own loopback Host/Origin. This is a local demo, not a remotely deployable authenticated service. Do not expose it publicly or remove the origin/host protections.

Create mission → try before approval → approve → execute → restart MCP process → replay last execution. Then select the shopping handoff and repeat approval, execution and restart/replay. The UI exports the actual session evidence as JSON.

The host spawns the unchanged MCP implementation in a separate process. Restart stops that process and starts another process against the same dedicated temporary store. The UI checks PID transition, exact receipt replay and unchanged effect counters. Each host invocation creates its own demo store; it never loads a real household's state.

## Record an actual browser journey

The public GitHub workflow `Hearthline browser recording` installs the recording dependency, executes one focused browser journey, and uploads video plus source/evidence. It does not invoke broad project suites, cloud models, paid services, live weather, or external household providers.

Local capture requires Python, Playwright with Chromium installed, and ffmpeg for MP4 encoding:

```sh
python3 -m pip install 'playwright==1.56.0'
python3 -m playwright install --with-deps chromium
python3 hearthline-browser-demo/record.py --output hearthline-recording
```

Stop any existing demo host before recording. The recording script owns port 8790. It refuses to overwrite an output directory. `--dwell` controls reading time (default five seconds per chapter); it does not change application responses. Video is actual Chromium output, not slides or fabricated UI states. Pointer interactions are automated; there is no claim of manual operation. The script verifies the full journey, saves the browser-generated JSON, captures a screenshot, converts the captured frames to MP4 when ffmpeg is present, and checks duration below three minutes with ffprobe.

Artifacts: `hearthline-browser-demo.webm`, optional MP4, `browser-evidence.json`, `CAPTURE_RECEIPT.json`, `final-browser.png`, and server log. The workflow also includes a revision-pinned source ZIP. The receipt links source commit, actual run, chapter timing, hashes and observed outcomes. Archive retention is three days; preserve the video before expiry.

## Simulation boundary

Real: MCP initialization, session/protocol negotiation, seven tool descriptions, tool calls over HTTP, durable state, explicit approvals, execution receipts, process termination/restart and replay checks.

Synthetic/local: weather warning, household, inventory, reminder outbox and shopping handoff. No Alexa device, LLM invocation, AWS deployment, purchase, real message delivery, account mutation, payment, registration, official contest submission or prize is represented by this demonstration. The banner and exported evidence identify those boundaries.

This supplements the existing original entrant's work and compensation/prize rights. For the Amazon contest, the actual entrant must still host the video publicly on YouTube or Vimeo, provide the URL in the correct entry, review eligibility/source requirements and submit through the authenticated provider. A GitHub artifact is not a qualifying video-host URL or an entry receipt. See the official rules and `../hearthline-alexa-mcp/JUDGE_PACKET.md`.

License: MIT; existing copyright and license at `../hearthline-alexa-mcp/LICENSE` apply and remain unchanged.
