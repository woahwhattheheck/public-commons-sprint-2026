# Optional Microsoft Foundry request admission (Counterpress Compass)

This extension protects the **optional** `/api/foundry-draft` server route. It does **not** add any provider calls to fixture replay, `/api/analyze`, health, or the judge's stateless synthetic demo.

The default budget admits at most **one concurrent paid draft**, **12 draft attempts in a rolling hour**, and **30 draft attempts in a rolling 24 hours**. A denied request returns HTTP 429 with a `Retry-After` header and a non-sensitive machine-readable reason (`IN_FLIGHT_LIMIT`, `HOURLY_LIMIT`, `DAILY_LIMIT`, or `DISABLED`). Existing unconfigured Foundry behavior stays HTTP 503 and incomplete evidence stays HTTP 422. A counted attempt is **not refunded** if the upstream call fails, because a provider timeout or ambiguous failure does not prove the request was free.

Optional server-side environment configuration:

```text
FOUNDRY_MAX_CONCURRENT=1
FOUNDRY_MAX_PER_HOUR=12
FOUNDRY_MAX_PER_DAY=30
```

Values are decimal integers 0..10000; `0` for any limit disables drafts. A malformed number fails server startup instead of accidentally removing the protection. No browser client may adjust the admission budget. The existing model adapter also caps the outbound completion request to 90 tokens, five seconds, and 16 KiB response bytes. Budgets are attempt caps, **not** proof of a cash spending limit. Limits are process-local and reset when the process restarts; for an internet-facing or multi-replica deployment add upstream authenticated admission, a shared durable quota, provider-level spending limits and monitoring before allowing live use.

This was developed as offline code against the existing recovered synthetic source, not on a live Azure account or deployed service. No charges, login, live API requests, video submission, or competition acceptance occurred. This original branch should be reconciled against current main before merge and must not overwrite concurrent server updates.
