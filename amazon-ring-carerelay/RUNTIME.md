# Ring WHEP lifecycle

`RingWhepClient` is a server-side adapter. It negotiates and terminates a session;
it does not implement a WebRTC peer, play video, create credentials, or attest
that a provider run or competition submission occurred.

## Use an existing authorized WebRTC peer

```python
from collections.abc import Callable
from carerelay.ring import RingWhepClient


def use_session(device_id: str, token: str, offer: str,
                consume_answer: Callable[[str], None]) -> None:
    client = RingWhepClient()
    with client.session(device_id, token, offer, timeout=10) as negotiated:
        # Configure the existing peer and finish the intended viewing operation
        # before returning; the context closes the remote session on exit.
        consume_answer(negotiated.sdp_answer)
```

Alternatively, use `create_session(...)` and call
`close_session(device_id, token, session)` in your own `finally` block. Keep
credentials server-side, supplied by the authorized account. Do not log tokens,
SDP, session URLs, or raw provider bodies.

## Transport and outcome rules

The default client installs its own non-redirecting opener. It never installs a
global urllib handler. Redirects fail without forwarding authorization or issuing
a second request. Custom injected openers are trusted code: they must enforce the
same no-redirect rule and return response objects with `close()`.

Creation requires HTTP 201, `application/sdp`, a bounded UTF-8 SDP answer whose
first line is `v=0`, and a validated Location. Only the documented HTTPS Ring
origin and the requested device's `/media/streaming/whep/sessions/{session_id}`
resource are accepted. A root-relative Location is resolved against that fixed
origin. Cross-device paths, userinfo, query/fragment data, traversal, and encoded
path segments are rejected before any authenticated follow-up.

Termination sends one authenticated DELETE to the validated resource. HTTP 200
or 204 confirms termination; 202, 404, transport errors, or other responses do
not silently become success. HTTP responses and HTTP-error bodies are closed on
both success and failure. Local response disposal is not remote termination.

A known 201 session whose Location is valid but whose SDP cannot be used gets
one compensating DELETE. An invalid Location cannot safely be followed. A POST
that times out or returns another uncertain outcome is never automatically
retried, and the adapter does not invent its remote state. The caller must
reconcile provider state or allow provider expiry rather than assume no session
exists. No backoff loop or additional credentials are used to bypass limits.

The context manager attempts cleanup after normal use and caller failure. A
cleanup error after normal use is surfaced. If the caller already raised, that
original error remains primary and receives a non-secret cleanup-failure note.
Applications must enforce the provider's session duration and their own viewing
budget; this adapter's timeout bounds each HTTP operation, not the entire body
of a caller's context.

## Focused local verification

```bash
PYTHONPATH=.:tests python -m unittest \
  test_ring_lifecycle.RingLifecycleTests test_carerelay.RingRuntimeTests -v
```

These are mocked transport checks, not a Ring device/simulator result. No live
session or account was used. The original entrant retains all applicable prize
eligibility; actual entry, judging, award and payout need their own receipts.

Protocol source checked October 9, 2026:
https://developer.amazon.com/docs/ring/api-documentation.html
(Live Video / WHEP creation, session Location, DELETE termination, server-to-server
access, and session cleanup guidance).
