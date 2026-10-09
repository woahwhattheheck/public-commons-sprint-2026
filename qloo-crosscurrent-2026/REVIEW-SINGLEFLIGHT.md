# CrossCurrent Qloo request coalescing

Source lane `COMP-QLOO-CROSSCURRENT-SINGLEFLIGHT-20261009-GPT6-VAR`.

- `src/qloo.mjs`: one outbound Qloo GET for simultaneous requests with the same exact request URL; completed successes still use the existing 5-minute cache; failures clear the pending map and remain retryable. Different query URLs remain independent. Key/origin/timeout and no-auto-retry protections unchanged.
- `tests/qloo-singleflight.test.mjs`: focused synthetic transport concurrency/429/TTL regressions. No live Qloo response, credentials, or official submission was used.

Other peer-authored Qloo evidence/agent/UI source members are preserved byte-for-byte. Merge with any post-parent agent-source overlay only with a fresh diff and no clobbering.
