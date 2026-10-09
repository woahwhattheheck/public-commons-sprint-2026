# Academic Evidence Studio — Hack Apertus Track 2A candidate

A working, no-dependency Node 22 web app that extracts **verifiable, UTF-16-offset citation excerpts** from pasted research text, optionally requests a structured *suggestion* from an OpenAI-compatible Apertus 1.5 endpoint, validates cited IDs, and keeps the final academic assessment with the human reviewer. No synthetic model results are presented as live research findings.

## Try it

```sh
node app.mjs
# open http://127.0.0.1:8787
node --test test.mjs  # single focused contract test file
```

Offline mode calls no provider. `POST /api/evaluate` accepts `{claim, sources:[{id,title,body}], mode:"offline"}`. The response includes original-source hashes, direct quotes with `[start,end)` offsets, and `review_status:"HUMAN_REVIEW_REQUIRED"`. The browser never renders untrusted excerpts as HTML. Review button state is deliberately local and is **not** an organizer submission.

For a **real Apertus analysis**, configure `APERTUS_ENDPOINT` (full HTTPS OpenAI-compatible chat-completions URL), `APERTUS_API_KEY`, and optionally `APERTUS_MODEL` before starting the server. Select *Live Apertus*. The provider must return a JSON object containing `verdict`, `reason`, and `evidence_ids`; guessed/unknown citations fail closed. Keys are server-side only. The service sends only pasted excerpts, not arbitrary URL fetches, and limits response/body size and provider timeout. Never paste private, licensed, or sensitive research documents without permission.

## Competition eligibility (not yet established)

The [official Hack Apertus listing](https://hackapertus.devpost.com/) advertises **CHF 2,500 cash** for Track 2A, and a strict **16 October 2026, 12:00 CEST** deadline. However, Track 2A requires matching an organizer-defined *Academia Challenge*. The linked organizer Getting Started Guide currently returned a 404 in the public reading environment. **This prototype has not been proven to match a named challenge, has not executed live Apertus inference, and is not registered or submitted.** Check the official challenge guide and entrant eligibility before attempting a contest entry. Do not mistake source readiness for an eligible, accepted, scored, or paid submission.

## Evidence semantics

- Citation offsets refer to UTF-16 code units in the original untouched JavaScript source text; source and quote SHA-256 identify exact content.
- Lexical overlap merely surfaces candidate passages; it does not prove support or contradiction.
- Model response is restricted to supplied excerpt IDs and remains `HUMAN_REVIEW_REQUIRED` even when syntactically valid.
- A model refusal, HTTP error, or absent key fails explicitly without substituting invented live results.

License: MIT. Synthetic example text in the UI has no scientific truth claim.