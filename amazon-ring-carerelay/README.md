# CareRelay — Amazon Ring track source carrier

CareRelay is a **privacy-minimized accessibility and caretaking workflow** for the 2026 *Build, Ship, Shape: Amazon Developer Hackathon* Ring track. It turns coarse Ring event facts into deterministic, human-reviewable proposals without storing video, identifying people, unlocking doors, contacting emergency services, or claiming an external side effect occurred.

## Competition target

- Official hackathon: <https://amazonappdev2026.devpost.com/>
- Official rules: <https://amazonappdev2026.devpost.com/rules>
- Deadline: **2026-10-23 12:00 PDT**.
- Ring cash awards in the current rules: **$12,000 first / $8,000 second**.
- Ring projects may use Ring APIs, SDKs, simulators, or devices; a physical Ring device is not required.
- The final repository/demo must actually use the Ring technology at runtime. This carrier contains a concrete WHEP runtime hook to Ring's documented video session endpoint rather than a README-only name-drop.
- A primary-track project may also enter the Open Source mini-challenge when its contribution satisfies those rules; no mini-challenge eligibility or award is claimed here.

## Product thesis

Ring explicitly names accessibility and caretaking among its priority categories. CareRelay focuses on a narrow trust boundary: use **event metadata first**, minimize retained information, and turn observations into *proposals* that a human may approve or reject. The current core never automatically unlocks access, dispatches a responder, calls emergency services, or sends an outbound message.

Examples:

- A human-classified doorbell event can propose an accessibility notice.
- Human-classified motion can propose a caretaking check-in.
- A degraded device-health event can propose a reliability review.
- Animal motion stays quiet in the default care policy.

## Runtime Ring integration

`carerelay/ring.py` implements a bounded client for the WHEP endpoint currently documented by Ring Developer:

`POST https://api.amazonvision.com/v1/devices/{deviceId}/media/streaming/whep/sessions`

with Bearer authorization and `application/sdp`. The client:

- validates device identifiers before URL construction;
- bounds offer/answer sizes;
- requires HTTP 201 + a session `Location`;
- never persists or returns the bearer token;
- rejects malformed/non-SDP responses.

**Provider truth ceiling:** this session did not create a Ring developer account, obtain credentials, run the official simulator, or negotiate a live WHEP session. The final provider/simulator demo is therefore `PROVIDER_EXECUTION_REQUIRED`, not green.

## Offline proof

```bash
python -m unittest discover -s tests -v
python -O -m unittest discover -s tests -v
python -m compileall -q carerelay tests
python -m carerelay.cli demo
```

The offline demo ingests synthetic event metadata, derives bounded proposals, records one human decision, and emits a content-addressed receipt whose authority fields remain false for Ring provider execution, external side effects, Devpost submission, award, and payment.

## Privacy and evidence boundary

Ingress rejects fields that would tempt the demo into laundering identity/video data (`person_name`, `face_id`, embeddings, transcripts, plates, raw video, image/video URLs). It rejects unknown fields, duplicate JSON keys, non-finite numbers, path-like identifiers, and timezone-free timestamps.

The receipt verifier recomputes the state digest and counters and refuses any receipt that self-promotes provider execution, side effects, Devpost submission, award, or payment.

## Remaining real-provider steps

1. Owner-authenticated Devpost/Ring account action after a fresh collision check.
2. Configure Ring's official simulator/test account and exercise the event path.
3. Execute the WHEP client against the documented Ring endpoint and retain a non-secret provider receipt (status/timestamp/session metadata only — never credentials or video).
4. Record genuine onboarding/friction observations in `SUBMISSION_PACKET.md`.
5. Produce the <3 minute demo through the official simulator or device.
6. Only then update provider-execution evidence. Devpost join/terms/submission remains a separate owner action.

Competition entry, award and payment have not yet been verified. The original entrant retains all applicable prize eligibility and seeks the awards available under the published rules.

## Session lifecycle

The runtime now disables redirects, validates same-device session URLs, closes HTTP responses, and exposes explicit DELETE termination plus context-managed cleanup. See [RUNTIME.md](RUNTIME.md) for usage, uncertain-outcome handling, and the focused transport checks.

## Review an event workspace in the browser

The local inbox completes the existing import → review → saved workspace flow without requiring hand-written decision files. On Linux or macOS with Python 3.10+, from this directory:

```bash
python -m carerelay.workbench import examples/workbench_events.jsonl --source offline-simulator --out household.json
python -m carerelay.workbench serve household.json --out-dir household-reviews --port 8792
```

Open `http://127.0.0.1:8792`. The existing example contains synthetic event metadata, clearly labeled `offline-simulator`. For an existing workspace, use its path instead of importing the example again. The inbox shows the original event context and proposal rationale, lets an operator record an explicit approval or rejection with a reviewer ID, and filters pending/completed decisions. Reviewer IDs attribute a decision; they are not authenticated identities. Recording a decision never sends a notice, dispatches a check-in, or changes a Ring device.

Every saved decision creates an immutable `workspace-<revision>.json` in the output directory and updates `current.json` atomically. The input workspace remains unchanged. Restart the same `serve` command with the same original input and output directory to resume the latest saved revision. Only one server writes that directory at a time. Multiple browser views may read it; a decision from an older revision is rejected so the operator can refresh and review current state. The current workspace download uses the original workspace format and remains usable by the existing CLI and report exporter.

The standard-library server binds only to `127.0.0.1`, accepts bounded JSON review requests, and does not enable cross-origin access. It is a local operator tool, not a hosted multi-user service. Stop it with Ctrl+C when finished. Source labels and the original proposal-only policy are preserved throughout; this browser workflow does not establish Ring simulator/device execution.
