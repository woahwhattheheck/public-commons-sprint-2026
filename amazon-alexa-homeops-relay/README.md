# HomeOps Relay — Alexa+ MCP household operations control plane

HomeOps Relay is a **stateful, local-first household maintenance and decision MCP server** built for the Alexa+ track of Amazon's 2026 Build, Ship, Shape hackathon.

The product turns messy household problems into an auditable workflow:

`issue → evidence → quotes → proposal → explicit human review → bounded side-effect request`

The last step is intentionally a **request**, not an execution. HomeOps Relay never sends a message, places an order, schedules a visit, changes a device, moves money, or claims that Alexa performed an action. A separate human-controlled executor would be required for any real-world side effect.

## Why this is more than an API wrapper

HomeOps Relay keeps issue state, evidence, quotes, plans, approvals, and a content-addressed event chain. A plan is bound to the exact current issue digest plus the exact evidence and quote digests available when the proposal is made. Approval is bound to the exact plan digest. A side-effect request is bound to both the approved plan and approval digests and is replay-protected by `action_id`.

This gives an Alexa+ agent a useful long-lived household workflow without granting the MCP server ambient real-world authority.

## MCP runtime

`mcp_server.py` implements the competition's required floor: **MCP 2025-11-25 over Streamable HTTP**.

Implemented wire behavior includes:

- `initialize` negotiation pinned to `2025-11-25`;
- stateful `Mcp-Session-Id` issuance and echo requirement;
- `notifications/initialized` lifecycle gate before tool traffic;
- `tools/list`, `tools/call`, and `ping`;
- JSON response mode over HTTP POST;
- DELETE session termination;
- optional GET stream declined explicitly with `405` rather than faking SSE;
- Host/Origin rebinding guard;
- 64 KiB request limit;
- strict JSON duplicate-key, non-finite, float, and unknown-envelope rejection;
- in-band MCP tool failures with `isError: true`;
- deterministic tool inventory.

The server uses only the Python standard library.

## Tools

- `homeops.create_issue`
- `homeops.add_evidence`
- `homeops.add_quote`
- `homeops.propose_plan`
- `homeops.review_plan`
- `homeops.request_side_effect`
- `homeops.get_issue`
- `homeops.verify_event_chain`

`homeops.request_side_effect` always returns:

```json
{
  "execution_authorized": false,
  "requires_external_executor": true
}
```

## Run

```bash
cd amazon-alexa-homeops-relay
python mcp_server.py
```

Then connect an MCP 2025-11-25 Streamable HTTP client to:

```text
http://127.0.0.1:8787/mcp
```

Health check:

```bash
curl http://127.0.0.1:8787/healthz
```

## Test

```bash
cd amazon-alexa-homeops-relay
python -m unittest -v tests/test_homeops.py
python -O -m unittest -v tests/test_homeops.py
python -m py_compile core.py mcp_server.py demo.py tests/test_homeops.py
python demo.py
```

The hostile suite covers lifecycle, version/session handling, Origin rejection, strict JSON, evidence binding, plan/approval binding, duplicate IDs, side-effect replay, authority boundaries, and event-chain tamper detection.

## Competition packet

- [`RULES_SNAPSHOT.md`](RULES_SNAPSHOT.md) — current official constraints used by this implementation
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — trust and data-flow design
- [`DEMO.md`](DEMO.md) — sub-three-minute judge demo storyboard
- [`SUBMISSION_COPY.md`](SUBMISSION_COPY.md) — ready-to-adapt Devpost narrative
- [`PRODUCT_FEEDBACK_DRAFT.md`](PRODUCT_FEEDBACK_DRAFT.md) — required product feedback + friction log draft
- [`SUBMISSION_READINESS.md`](SUBMISSION_READINESS.md) — what is complete and what remains account/video/submission work

## License

This project lives in the public `woahwhattheheck/public-commons-sprint-2026` repository, whose root `LICENSE` is MIT. The hackathon's public-repository requirement should still be rechecked immediately before submission, including how GitHub displays the license at the top of the repository page.

## Truth boundary

Current source/test/demo readiness is **not** Devpost registration, Alexa account/provider execution, a public video, submission, judging acceptance, an award, payment, or revenue. Those remain separate owner/account/provider actions.
