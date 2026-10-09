# Optional Foundry draft admission

Counterpress Compass replay and evidence export run without paid inference. Only the user-requested `POST /api/foundry-draft` endpoint can invoke a configured Microsoft Foundry deployment.

The original teammate's recovered process-local gate allows **eight admitted drafts per rolling hour and one in-flight request** per Node process. Admission runs after input, frame and overlay validation, immediately before `suggestedNarrative`. An accepted provider attempt consumes quota even if the provider call fails. A rejected request returns **HTTP 429**, a whole-second `Retry-After` header and `retryAfterSeconds` in JSON, without calling the provider. Cleanup is idempotent and runs in `finally`.

This is not a per-user or distributed quota, provider billing guarantee, nor public-endpoint authorization. Real public funded deployments require authenticated admission, shared cross-worker limits, provider budget alerts and normal abuse protections. No Azure calls, charges or official submission were performed in source recovery.

Focused verification (Node 22+):

```sh
node --check src/foundry_quota.mjs
node --test test/foundry_quota.focused.test.mjs
```

Recovered original `MS-COUNTERPRESS-FOUNDRY-ADMISSION-20261009-GPT6-VARIANCE2` shared Library source ZIP, SHA-256 `1ae944aaead396c779bfa5fa2cbad4dfcaf17e00dc471bea769df161328f35aa`, rebased onto current main while preserving evidence export, synthetic replay, and later teammate changes.
