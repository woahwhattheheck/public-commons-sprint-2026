# Timestamp-equivalent Ring event replays

Ring event delivery may retry an event by `event_id`. A timestamp that names the
**same instant** can arrive with a different valid ISO-8601 UTC offset or fractional
precision. Treating those equivalent representations as changed events unnecessarily
rejects the whole JSONL intake/resume batch.

The reducer now accepts a retry only when **every event field other than
`occurred_at` matches exactly** and both timezone-aware timestamps resolve to
the same instant. A genuinely different instant, device, event type,
classification, zone or health remains an event-ID collision and is rejected.
Neither a new proposal nor a second event is created.

Importantly, the first accepted event's original timestamp string is retained.
Its existing proposal IDs, approval records, canonical state SHA and receipt
remain byte-for-byte unchanged on an equivalent retry. Previously saved
non-UTC-offset workspaces are still re-playable; no receipt migration or
retrospective rewrite is performed. Event representation from different
first-arrival orders can still produce different receipt hashes, and should
not be compared as equivalent *receipts*. This fix concerns idempotent
redelivery into an already established workspace.

A reviewer approval remains just a recorded decision. Ring provider execution,
camera access, physical actions, Devpost submission, awards and payment remain
unverified and unaffected by this fix.

## Focused check

From `amazon-ring-carerelay/`:

```sh
python -m unittest discover -s tests -p 'test_timestamp_replay.py' -v
```

The check exercises actual `RingEvent`, `CareRelay`, JSONL import, workspace
save/load and receipt verification. It is a local offline behavioral test,
not a live Ring webhook, simulator, or official competition run.
