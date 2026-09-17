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

No prize, payment, or revenue is claimed by this source carrier.
