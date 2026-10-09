# WorkSeal artifact judge walkthrough

This implementation uses the existing local Linux verifier, which reads actual selected files rather than accepting a hash declaration. The browser's existing GitHub Actions example is separate and does not establish that a delivered file was re-read.

## Reviewer flow

1. Buyer creates a reference manifest from immutable reference bytes with `artifact_manifest_cli.mjs manifest` and pins the returned `artifact-manifest` requirement in the task *before* worker delivery.
2. Worker prepares the result for the correct task, worker and generation, then the independent verifier re-reads delivered files and returns a verification check.
3. The existing WorkSeal receipt code incorporates that check into the exact signed result-generation receipt. The settlement intent is descriptive and does not execute a payment.
4. Alter one selected delivery file without altering the pinned manifest. Running the exact same verifier must return `ARTIFACT_CONTENT_MISMATCH`. The previously accepted receipt cannot authorize the changed bytes.

The executable source is `src/artifact_manifest_cli.mjs` and `src/artifact_manifest.mjs`; focused existing evidence is `test/artifact_manifest.test.mjs`. These files already exist on main and are reused, rather than replacing their verification logic.

**Evidence limits:** the reference's origin must be independently trusted; the verifier must receive an isolated immutable delivery snapshot. Browser-only review of displayed hashes does not recheck local bytes. No contest submission or live financial outcome is asserted.
